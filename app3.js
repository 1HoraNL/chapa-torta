// Supabase Configuration
const SUPABASE_URL = 'https://sgsjghzbicqxefoovsiy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNnc2pnaHpiaWNxeGVmb292c2l5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5NzAxMzYsImV4cCI6MjA4MDU0NjEzNn0.kR5tIL6xToZH9eEpNHTj9-DnDyGVYK3SKcuDPPaLSVo';

// Initialize Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Default Roster
const defaultRoster = [
    "Alberto", "Amarildo", "Arthur",
    "Batata", "Caleffi", "Callefinho",
    "Gilson", "Pedro", "Rafael", "Rodrigo", "Vinicius"
];

let currentGameId = null;
let confirmedPlayers = new Set();

// DOM Elements
const rosterGrid = document.getElementById('rosterGrid');
const confirmedCountSpan = document.getElementById('confirmedCount');
const absentCountSpan = document.getElementById('absentCount');
const nextGameInfo = document.getElementById('nextGameInfo');
const sendConfirmationBtn = document.getElementById('sendConfirmationBtn');

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    // Update game date
    const nextSundayDate = getNextSunday();
    nextGameInfo.textContent = `${nextSundayDate} | 07 às 09`;

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
    const nextSunday = getNextSundayFull();

    // Check if game exists for this Sunday
    const { data: existingGame, error: fetchError } = await supabase
        .from('games')
        .select('*')
        .eq('game_date', nextSunday)
        .single();

    if (existingGame) {
        currentGameId = existingGame.id;
    } else {
        // Create new game
        const { data: newGame, error: insertError } = await supabase
            .from('games')
            .insert([{ game_date: nextSunday, status: 'open' }])
            .select()
            .single();

        if (newGame) {
            currentGameId = newGame.id;
        } else {
            console.error('Error creating game:', insertError);
        }
    }
}

// Load Confirmations
async function loadConfirmations() {
    if (!currentGameId) return;

    const { data, error } = await supabase
        .from('confirmations')
        .select('player_name')
        .eq('game_id', currentGameId);

    if (data) {
        confirmedPlayers = new Set(data.map(c => c.player_name));
        updateCounters();
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

    defaultRoster.forEach(player => {
        const card = document.createElement('div');
        card.className = 'player-card';

        if (confirmedPlayers.has(player)) {
            card.classList.add('confirmed');
        }

        card.innerHTML = `
            <i class="player-icon ${confirmedPlayers.has(player) ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle'}"></i>
            <span class="player-name">${player}</span>
        `;

        card.addEventListener('click', () => toggleConfirmation(player));

        rosterGrid.appendChild(card);
    });
}

// Toggle Confirmation
async function toggleConfirmation(playerName) {
    if (!currentGameId) return;

    if (confirmedPlayers.has(playerName)) {
        // Remove confirmation
        const { error } = await supabase
            .from('confirmations')
            .delete()
            .eq('game_id', currentGameId)
            .eq('player_name', playerName);

        if (!error) {
            confirmedPlayers.delete(playerName);
        }
    } else {
        // Add confirmation
        const { error } = await supabase
            .from('confirmations')
            .insert([{
                game_id: currentGameId,
                player_name: playerName
            }]);

        if (!error) {
            confirmedPlayers.add(playerName);
        }
    }

    renderRoster();
    updateCounters();
}

// Update Counters
function updateCounters() {
    confirmedCountSpan.textContent = confirmedPlayers.size;
    absentCountSpan.textContent = defaultRoster.length - confirmedPlayers.size;
}

// Send to WhatsApp
function sendToWhatsApp() {
    const confirmed = Array.from(confirmedPlayers).sort();
    const date = getNextSunday();
    const isPastDeadline = isAfterDeadline();

    let message = '🚨🚨🚨🚨🚨🚨🚨🚨\n🫵🫵🫵🫵🫵🫵🫵🫵\n\n\n';
    message += `📆 Data: ${date} (Dom)\n⏰ Horas: 07 às 09\n🎯 Quadra: JJ1\n\n`;

    if (!isPastDeadline) {
        message += `⏳ *Prazo para confirmar: Sábado 14h*\n\n`;
    }

    message += `\n✅ Presentes:\n\n`;

    confirmed.forEach((name, index) => {
        message += `${String(index + 1).padStart(2, '0')}- ${name}\n`;
    });

    for (let i = confirmed.length; i < 10; i++) {
        message += `${String(i + 1).padStart(2, '0')}-\n`;
    }

    // Only show absent after deadline
    if (isPastDeadline) {
        const absent = defaultRoster.filter(p => !confirmedPlayers.has(p)).sort();
        message += '\n\n❌ Ausentes\n\n';
        absent.forEach((name, index) => {
            message += `${String(index + 1).padStart(2, '0')}- ${name}\n`;
        });

        for (let i = absent.length; i < 5; i++) {
            message += `${String(i + 1).padStart(2, '0')}-\n`;
        }
    }

    // Add link at the end
    message += '\n\n🔗 *Confirme sua presença:*\n';
    message += 'https://1horanl.github.io/chapa-torta/index3.html';

    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
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
    return `${day}/${month}`;
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
    return `${year}-${month}-${day}`;
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
