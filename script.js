import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// --- PASTE YOUR CONFIG HERE ---
const firebaseConfig = {
    apiKey: "AIzaSyDqGpkidq1gyAXyBSdQm9YsCRt5xMP09z0",
    authDomain: "money-manager-63c87.firebaseapp.com",
    projectId: "money-manager-63c87",
    storageBucket: "money-manager-63c87.firebasestorage.app",
    messagingSenderId: "275596057174",
    appId: "1:275596057174:web:ed7119592a7f7a57f639f7",
    measurementId: "G-Q3MBNLCX3E"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let currentUser = null;
let appData = { accounts: [], transactions: [] };
let chartInstance = null;

// --- THEME LOGIC ---
window.toggleTheme = () => {
    const body = document.body;
    const isDark = body.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    
    body.setAttribute('data-theme', newTheme);
    document.getElementById('themeIcon').className = newTheme === 'dark' ? 'ri-sun-line' : 'ri-moon-line';
    
    // Update chart theme dynamically
    if(chartInstance) {
        chartInstance.updateOptions({ theme: { mode: newTheme } });
    }
};

// --- AUTH LOGIC ---
onAuthStateChanged(auth, (user) => {
    const overlay = document.getElementById('authOverlay');
    const container = document.getElementById('appContainer');
    
    if (user) {
        currentUser = user;
        overlay.style.display = 'none';
        container.style.filter = 'none';
        initApp();
    } else {
        currentUser = null;
        overlay.style.display = 'flex';
        container.style.filter = 'blur(5px)';
    }
});

window.handleAuth = async (type) => {
    const email = document.getElementById('authEmail').value;
    const pass = document.getElementById('authPass').value;
    const msg = document.getElementById('authMsg');

    try {
        if (type === 'signup') {
            await createUserWithEmailAndPassword(auth, email, pass);
            await setDoc(doc(db, "users", auth.currentUser.uid), {
                accounts: [{ id: 'acc_cash', name: 'Cash', balance: 0 }],
                transactions: []
            });
        } else {
            await signInWithEmailAndPassword(auth, email, pass);
        }
    } catch (e) {
        msg.innerText = e.message;
        msg.style.color = "#ef4444";
    }
};

window.handleLogout = () => signOut(auth);

// --- APP CORE ---
function initApp() {
    onSnapshot(doc(db, "users", currentUser.uid), (docSnap) => {
        if (docSnap.exists()) {
            appData = docSnap.data();
            updateUI();
        }
    });

    const today = new Date().toISOString().split('T')[0];
    ['incDate', 'expDate', 'transDate'].forEach(id => document.getElementById(id).value = today);
}

function updateUI() {
    renderDashboard();
    renderHistory();
    renderChart();
    updateDropdowns();
    document.getElementById('status').innerHTML = '<i class="ri-check-double-line"></i> Synced';
}

function renderDashboard() {
    const container = document.getElementById('accountCards');
    container.innerHTML = '';
    
    const netWorth = appData.accounts.reduce((sum, a) => sum + a.balance, 0);
    
    container.innerHTML += `
        <div class="card" style="border-left: 4px solid var(--primary)">
            <h3 style="margin:0; font-size:0.9rem; color:var(--text-muted)">TOTAL NET WORTH</h3>
            <div class="amount" style="color:var(--primary)">$${netWorth.toLocaleString()}</div>
        </div>`;

    appData.accounts.forEach(acc => {
        container.innerHTML += `
            <div class="card">
                <h3 style="margin:0; font-size:0.9rem; color:var(--text-muted)">${acc.name}</h3>
                <div class="amount">$${acc.balance.toLocaleString()}</div>
            </div>`;
    });
}

function renderHistory() {
    const list = document.getElementById('historyList');
    list.innerHTML = '';
    const recent = appData.transactions.slice().sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 8);
    
    recent.forEach(t => {
        const li = document.createElement('li');
        li.className = 'history-item';
        
        let valClass = t.type === 'income' ? 'val-green' : (t.type === 'expense' ? 'val-red' : '');
        let sign = t.type === 'income' ? '+' : (t.type === 'expense' ? '-' : '');
        
        li.innerHTML = `
            <div>
                <div style="font-weight:600">${t.reason}</div>
                <div style="font-size:0.8rem; color:var(--text-muted)">${t.date.split('T')[0]}</div>
            </div>
            <div class="${valClass}">
                ${sign}$${t.amount.toLocaleString()}
            </div>
        `;
        list.appendChild(li);
    });
}

// --- NEW LINE CHART ENGINE ---
function renderChart() {
    if (!appData.transactions.length) return;

    // 1. Sort transactions by date
    const sortedTx = [...appData.transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // 2. Prepare data structure for multiple series
    // Map account ID -> { name, data: [{x, y}] }
    const seriesMap = {};
    
    // Initialize map with all current accounts
    appData.accounts.forEach(acc => {
        seriesMap[acc.id] = {
            name: acc.name,
            currentBal: 0,
            data: []
        };
    });

    // 3. Replay history to build the lines
    // We assume starting balance was 0 for all
    sortedTx.forEach(t => {
        const dateTimestamp = new Date(t.date).getTime();

        // Ensure accounts exist in map (handle deleted/new accounts gracefully)
        if (t.account && !seriesMap[t.account]) seriesMap[t.account] = { name: "Unknown", currentBal: 0, data: [] };
        if (t.from && !seriesMap[t.from]) seriesMap[t.from] = { name: "Unknown", currentBal: 0, data: [] };
        if (t.to && !seriesMap[t.to]) seriesMap[t.to] = { name: "Unknown", currentBal: 0, data: [] };

        if (t.type === 'income') {
            seriesMap[t.account].currentBal += t.amount;
            seriesMap[t.account].data.push({ x: dateTimestamp, y: seriesMap[t.account].currentBal });
        } 
        else if (t.type === 'expense') {
            seriesMap[t.account].currentBal -= t.amount;
            seriesMap[t.account].data.push({ x: dateTimestamp, y: seriesMap[t.account].currentBal });
        }
        else if (t.type === 'transfer') {
            // Update sender
            seriesMap[t.from].currentBal -= t.amount;
            seriesMap[t.from].data.push({ x: dateTimestamp, y: seriesMap[t.from].currentBal });
            
            // Update receiver
            seriesMap[t.to].currentBal += t.amount;
            seriesMap[t.to].data.push({ x: dateTimestamp, y: seriesMap[t.to].currentBal });
        }
    });

    // 4. Convert map to Array for ApexCharts
    const seriesData = Object.values(seriesMap).map(s => ({
        name: s.name,
        data: s.data
    }));

    // 5. Render
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    
    const options = {
        series: seriesData,
        chart: {
            type: 'line',
            height: 350,
            background: 'transparent',
            toolbar: { show: false },
            zoom: { enabled: false }
        },
        theme: { mode: isDark ? 'dark' : 'light' },
        stroke: { curve: 'smooth', width: 3 },
        xaxis: { 
            type: 'datetime',
            tooltip: { enabled: false } 
        },
        yaxis: { 
            labels: { formatter: (val) => "$" + val.toFixed(0) } 
        },
        colors: ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'],
        grid: {
            borderColor: isDark ? '#374151' : '#e5e7eb',
            strokeDashArray: 4
        },
        legend: {
            position: 'top',
            horizontalAlign: 'right'
        }
    };

    if (chartInstance) chartInstance.destroy();
    chartInstance = new ApexCharts(document.querySelector("#mainChart"), options);
    chartInstance.render();
}

// --- ACTIONS ---
window.saveData = async () => {
    await setDoc(doc(db, "users", currentUser.uid), appData);
};

window.createNewAccount = async () => {
    const name = document.getElementById('newAccountName').value;
    if(!name) return;
    appData.accounts.push({ id: 'acc_'+Date.now(), name, balance: 0 });
    document.getElementById('newAccountName').value = '';
    await saveData();
};

window.addTransaction = async (type) => {
    const prefix = type === 'income' ? 'inc' : 'exp';
    const amount = parseFloat(document.getElementById(prefix+'Amount').value);
    const date = document.getElementById(prefix+'Date').value;
    const accId = document.getElementById(prefix+'Account').value;
    const reason = document.getElementById(prefix+'Reason').value;

    if(!amount || !reason) return alert("Fill all fields");

    const acc = appData.accounts.find(a => a.id === accId);
    
    if(type === 'expense') {
        if(acc.balance < amount) return alert("Insufficient Funds");
        acc.balance -= amount;
    } else {
        acc.balance += amount;
    }

    appData.transactions.push({
        type, amount, reason, account: accId, 
        date: new Date(date).toISOString() 
    });

    document.getElementById(prefix+'Amount').value = '';
    document.getElementById(prefix+'Reason').value = '';
    await saveData();
};

window.transferMoney = async () => {
    const amount = parseFloat(document.getElementById('transAmount').value);
    const date = document.getElementById('transDate').value;
    const fromId = document.getElementById('transFrom').value;
    const toId = document.getElementById('transTo').value;

    if(!amount || fromId === toId) return alert("Invalid Transfer");
    const fromAcc = appData.accounts.find(a => a.id === fromId);
    const toAcc = appData.accounts.find(a => a.id === toId);

    if(fromAcc.balance < amount) return alert("Insufficient Funds");

    fromAcc.balance -= amount;
    toAcc.balance += amount;

    appData.transactions.push({
        type: 'transfer', amount, from: fromId, to: toId, 
        reason: 'Transfer', date: new Date(date).toISOString()
    });

    await saveData();
};

// Utils
window.switchTab = (tab, e) => {
    document.querySelectorAll('.form-section').forEach(f => f.classList.add('hidden'));
    document.getElementById(tab+'Form').classList.remove('hidden');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
};

function updateDropdowns() {
    const selects = document.querySelectorAll('.account-select');
    selects.forEach(s => {
        const old = s.value;
        s.innerHTML = appData.accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
        if(old) s.value = old;
    });
}
