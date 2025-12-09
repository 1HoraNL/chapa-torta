// Supabase Configuration
const SUPABASE_URL = 'https://sgsjghzbicqxefoovsiy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNnc2pnaHpiaWNxeGVmb292c2l5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5NzAxMzYsImV4cCI6MjA4MDU0NjEzNn0.kR5tIL6xToZH9eEpNHTj9-DnDyGVYK3SKcuDPPaLSVo';

// Initialize Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Default Roster
const defaultRoster = [
    "Alberto", "Amarildo", "Arthur",
    "Batata", "Caleffi", "Callefinho",
    "Diego", "Gilson", "Pedro", "Rafael", "Rodrigo", "Vinicius"
];

let currentGameId = null;
let playerStatus = {}; // { playerName: 'confirmed' | 'absent' | null }
let confirmedQueue = []; // List of confirmed players in order of confirmation time

// DOM Elements
const rosterGrid = document.getElementById('rosterGrid');
const confirmedCountSpan = document.getElementById('confirmedCount');
const waitlistCountSpan = document.getElementById('waitlistCount');
const absentCountSpan = document.getElementById('absentCount');
const noResponseCountSpan = document.getElementById('noResponseCount');
const nextGameInfo = document.getElementById('nextGameInfo');
const sendConfirmationBtn = document.getElementById('sendConfirmationBtn');

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    // Update game date
    const nextSundayDate = getNextSunday();
    nextGameInfo.textContent = `${nextSundayDate} | 07 às 09`;

    // Initialize player status
    defaultRoster.forEach(player => {
        playerStatus[player] = null;
    });

    // Initialize or get current game
    await initializeGame();

    // Load confirmations
    await loadConfirmations();

    // Render roster
    renderRoster();

    // Setup real-time subscription
    setupRealtimeSubscription();

    // Send to WhatsApp
    sendConfirmationBtn.addEventListener('click', sendToWhatsApp);
});

// Initialize Game
async function initializeGame() {
    try {
        const nextSunday = getNextSundayFull();

        // Check if game exists for this Sunday
        const { data: existingGame, error: fetchError } = await supabase
            .from('games')
            .select('*')
            .eq('game_date', nextSunday)
            .single();

        if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 is "Row not found"
            throw fetchError;
        }

        if (existingGame) {
            currentGameId = existingGame.id;
        } else {
            // Create new game
            const { data: newGame, error: insertError } = await supabase
                .from('games')
                .insert([{ game_date: nextSunday, status: 'open' }])
                .select()
                .single();

            if (insertError) throw insertError;

            if (newGame) {
                currentGameId = newGame.id;
            }
        }

    } catch (error) {
        console.error('CRITICAL ERROR initializing game:', error);
        nextGameInfo.textContent = 'Erro ao conectar. Recarregue a página.';
        nextGameInfo.style.color = 'red';
        alert('Erro de conexão com o sistema. Por favor, verifique sua internet e recarregue a página.\n\nDetalhes: ' + (error.message || 'Erro desconhecido'));
    }
}

// Load Confirmations
async function loadConfirmations() {
    if (!currentGameId) return;

    try {
        const { data, error } = await supabase
            .from('confirmations')
            .select('player_name, status')
            .eq('game_id', currentGameId)
            // Tabela não tem created_at, usando id para manter ordem de inserção (se id for serial)
            // Se id não existir, remover o .order completamente
            .order('id', { ascending: true });

        if (error) throw error;

        if (data) {
            confirmedQueue = []; // Reset queue
            playerStatus = {}; // Reset status map

            // Reset to initial null state first
            defaultRoster.forEach(player => playerStatus[player] = null);

            data.forEach(confirmation => {
                playerStatus[confirmation.player_name] = confirmation.status;
                if (confirmation.status === 'confirmed') {
                    confirmedQueue.push(confirmation.player_name);
                }
            });
            updateCounters();
        }
    } catch (error) {
        console.error('Error loading confirmations:', error);
        // Display detailed error for debugging
        const errorMsg = error.message || JSON.stringify(error) || 'Erro desconhecido';
        nextGameInfo.textContent = `Erro: ${errorMsg}`;
        nextGameInfo.style.color = 'red';
    }
}

// Setup Real-time Subscription
function setupRealtimeSubscription() {
    supabase
        .channel('confirmations-channel')
        .on('postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'confirmations',
                filter: `game_id=eq.${currentGameId}`
            },
            (payload) => {
                console.log('Change received!', payload);
                loadConfirmations().then(() => renderRoster());
            }
        )
        .subscribe();
}

// Render Roster
function renderRoster() {
    rosterGrid.innerHTML = '';

    const { mainList, waitList } = getSplitLists();

    defaultRoster.forEach(player => {
        const row = document.createElement('div');
        row.className = 'player-row';

        const status = playerStatus[player];
        let statusLabel = '';

        if (status === 'confirmed') {
            row.classList.add('confirmed');
            if (waitList.includes(player)) {
                statusLabel = ' (Excedente)';
                row.style.border = '1px solid #FF9500'; // Visual clue for waitlist
            }
        } else if (status === 'absent') {
            row.classList.add('absent');
        }

        row.innerHTML = `
            <span class="player-name">${player}${statusLabel}</span>
            <div class="player-actions">
                <button class="btn-confirm ${status === 'confirmed' ? 'active' : ''}" data-player="${player}" data-action="confirm">
                    <i class="fa-solid fa-check"></i> VOU
                </button>
                <button class="btn-absent ${status === 'absent' ? 'active' : ''}" data-player="${player}" data-action="absent">
                    <i class="fa-solid fa-xmark"></i> NÃO VOU
                </button>
            </div>
        `;

        // Add event listeners
        const confirmBtn = row.querySelector('.btn-confirm');
        const absentBtn = row.querySelector('.btn-absent');

        confirmBtn.addEventListener('click', () => setPlayerStatus(player, 'confirmed'));
        absentBtn.addEventListener('click', () => setPlayerStatus(player, 'absent'));

        rosterGrid.appendChild(row);
    });
}

// Helper to split confirmed list
function getSplitLists() {
    const mainList = confirmedQueue.slice(0, 10);
    const waitList = confirmedQueue.slice(10);
    return { mainList, waitList };
}

// Set Player Status
async function setPlayerStatus(playerName, status) {
    if (!currentGameId) {
        console.warn('Game ID missing, attempting to re-initialize...');
        await initializeGame();
        if (!currentGameId) {
            alert('Erro: Jogo não inicializado. Tente recarregar a página.');
            return;
        }
    }

    const currentStatus = playerStatus[playerName];

    // If clicking the same button, remove status
    if (currentStatus === status) {
        // Delete from database
        const { error } = await supabase
            .from('confirmations')
            .delete()
            .eq('game_id', currentGameId)
            .eq('player_name', playerName);

        if (!error) {
            playerStatus[playerName] = null;
        }
    } else {
        // Delete first to ensure new created_at timestamp (move to end of queue)
        await supabase
            .from('confirmations')
            .delete()
            .eq('game_id', currentGameId)
            .eq('player_name', playerName);

        // Insert new record
        const { error } = await supabase
            .from('confirmations')
            .insert([{
                game_id: currentGameId,
                player_name: playerName,
                status: status
            }]);

        if (!error) {
            playerStatus[playerName] = status;
        }
    }

    await loadConfirmations(); // Reload to get fresh server order
    renderRoster();
}

// Update Counters
function updateCounters() {
    const { mainList, waitList } = getSplitLists();
    let absent = 0;
    let noResponse = 0;

    defaultRoster.forEach(player => {
        const status = playerStatus[player];
        if (status === 'absent') absent++;
        else if (status !== 'confirmed') noResponse++;
    });

    confirmedCountSpan.textContent = mainList.length;
    waitlistCountSpan.textContent = waitList.length;
    absentCountSpan.textContent = absent;
    noResponseCountSpan.textContent = noResponse;

    // Update Draw Section too if needed
    updateDrawSection();
}

// Send to WhatsApp
function sendToWhatsApp() {
    const { mainList, waitList } = getSplitLists();
    const absent = [];
    const noResponse = [];

    defaultRoster.forEach(player => {
        const status = playerStatus[player];
        if (status === 'absent') absent.push(player);
        else if (status !== 'confirmed') noResponse.push(player);
    });

    const date = getNextSunday();
    const isPastDeadline = isAfterDeadline();

    // Listagem simples sem emojis para garantir compatibilidade
    let message = '*Chapa Torta - Confirmacao*\n\n';
    message += 'Data: ' + date + ' (Dom)\n';
    message += 'Horas: 07 as 09\n';
    message += 'Quadra: JJ1\n\n';

    if (!isPastDeadline) {
        message += 'Confirmar ate Sab. as 14h\n\n';
    }

    message += '\n*Confirmados:*\n';

    mainList.forEach((name, index) => {
        const num = String(index + 1).padStart(2, '0');
        message += num + '- ' + name + '\n';
    });

    for (let i = mainList.length; i < 10; i++) {
        const num = String(i + 1).padStart(2, '0');
        message += num + '-\n';
    }

    // Show absent 
    if (absent.length > 0) {
        message += '\n*Ausentes:*\n';
        absent.sort().forEach((name, index) => {
            const num = String(index + 1).padStart(2, '0');
            message += num + '- ' + name + '\n';
        });
    }

    // Show Excedentes (Waitlist) AFTER Absents as requested
    if (waitList.length > 0) {
        message += '\n*Excedentes:*\n';
        waitList.forEach((name, index) => {
            const num = String(index + 1).padStart(2, '0');
            message += num + '- ' + name + '\n';
        });
    }

    // Show who didn't respond
    if (noResponse.length > 0) {
        message += '\n*Sem confirmacao:*\n';
        noResponse.sort().forEach((name, index) => {
            const num = String(index + 1).padStart(2, '0');
            message += num + '- ' + name + '\n';
        });
    }

    // Add link at the end
    message += '\n\n*Confirme sua presenca:*\n';
    message += 'https://1horanl.github.io/chapa-torta/index3.html';

    const whatsappUrl = 'https://wa.me/?text=' + encodeURIComponent(message);

    window.location.href = whatsappUrl;
}

// Check if current time is after Saturday 14h
function isAfterDeadline() {
    const now = new Date();
    const nextSunday = getNextSundayDate();

    // Get the Saturday before next Sunday
    const saturday = new Date(nextSunday);
    saturday.setDate(saturday.getDate() - 1); // Go back 1 day to Saturday
    saturday.setHours(14, 0, 0, 0); // Set to 14:00

    return now >= saturday;
}

// Get Next Sunday (DD/MM format)
function getNextSunday() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysUntilSunday = (7 - dayOfWeek) % 7 || 7;
    const nextSunday = new Date(today);
    nextSunday.setDate(today.getDate() + daysUntilSunday);

    const day = String(nextSunday.getDate()).padStart(2, '0');
    const month = String(nextSunday.getMonth() + 1).padStart(2, '0');
    return day + '/' + month;
}

// Get Next Sunday (YYYY-MM-DD format for database)
function getNextSundayFull() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysUntilSunday = (7 - dayOfWeek) % 7 || 7;
    const nextSunday = new Date(today);
    nextSunday.setDate(today.getDate() + daysUntilSunday);

    const year = nextSunday.getFullYear();
    const month = String(nextSunday.getMonth() + 1).padStart(2, '0');
    const day = String(nextSunday.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
}

// Get Next Sunday as Date object
function getNextSundayDate() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysUntilSunday = (7 - dayOfWeek) % 7 || 7;
    const nextSunday = new Date(today);
    nextSunday.setDate(today.getDate() + daysUntilSunday);
    return nextSunday;
}

/* ==========================================
   NAVIGATION & DRAW LOGIC
   ========================================== */

// DOM Elements for Navigation and Draw
const navTabs = document.querySelectorAll('.nav-tab');
const sections = document.querySelectorAll('section');
const playersForDrawCount = document.getElementById('playersForDrawCount');
const confirmedPlayersList = document.getElementById('confirmedPlayersList');
const generateTeamsBtn = document.getElementById('generateTeamsBtn');
const teamsResult = document.getElementById('teamsResult');

// Navigation Tab Logic
navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        // Remove active class from all tabs
        navTabs.forEach(t => t.classList.remove('active'));
        // Add active class to clicked tab
        tab.classList.add('active');

        // Hide all sections
        sections.forEach(section => {
            section.classList.remove('active-section');
            section.classList.add('hidden-section');
        });

        // Show target section
        const targetId = tab.getAttribute('data-target');
        const targetSection = document.getElementById(targetId);
        targetSection.classList.remove('hidden-section');
        targetSection.classList.add('active-section');

        // If switching to Draw section, update count
        if (targetId === 'drawSection') {
            updateDrawSection();
        }
    });
});

// Update Draw Section Info
function updateDrawSection() {
    const { mainList } = getSplitLists();
    playersForDrawCount.textContent = mainList.length;

    // Show names of confirmed players
    if (mainList.length > 0) {
        confirmedPlayersList.innerHTML = mainList.map(player =>
            `<span class="confirmed-player-tag">${player}</span>`
        ).join('');
    } else {
        confirmedPlayersList.innerHTML = '<span class="empty-message">Nenhum jogador confirmado ainda.</span>';
    }

    teamsResult.innerHTML = ''; // Clear previous results
}

// Get Confirmed Players List
function getConfirmedPlayers() {
    return defaultRoster.filter(player => playerStatus[player] === 'confirmed');
}

// Generate Teams Logic
generateTeamsBtn.addEventListener('click', () => {
    // Play sound effect
    const audio = new Audio('peido.mp3');
    audio.play().catch(e => console.log('Audio play failed:', e));

    const { mainList: players } = getSplitLists();

    if (players.length < 2) {
        alert('É necessário pelo menos 2 jogadores confirmados para realizar o sorteio!');
        return;
    }

    // Shuffle players (Fisher-Yates algorithm)
    const shuffled = [...players];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Generate Teams (Duplas)
    const teams = [];
    while (shuffled.length > 0) {
        // Sempre faz duplas (ou um sozinho se sobrar)
        teams.push(shuffled.splice(0, 2));
    }

    displayTeams(teams);
});

// Display Teams
function displayTeams(teams) {
    teamsResult.innerHTML = '';

    teams.forEach((team, index) => {
        const teamCard = document.createElement('div');
        teamCard.className = 'game-match-card';

        let teamHtml = `
            <div class="game-header">DUPLA ${index + 1}</div>
            <div class="game-teams">
                <div class="team">
                    <div class="team-players">
                        ${team.map(p => `<div>${p}</div>`).join('')}
                    </div>
                </div>
            </div>
        `;

        teamCard.innerHTML = teamHtml;
        teamsResult.appendChild(teamCard);
    });
}
