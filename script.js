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
let currentChartType = 'line'; // Default to Line chart

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
    
    // Calculate Total
    const netWorth = appData.accounts.reduce((sum, a) => sum + a.balance, 0);
    
    // Total Card (Special Style)
    container.innerHTML += `
        <div class="card" style="border-left: 4px solid var(--primary)">
            <h3 style="margin:0; font-size:0.9rem; color:var(--text-muted)">TOTAL NET WORTH</h3>
            <div class="amount" style="color:var(--primary)">$${netWorth.toLocaleString()}</div>
        </div>`;

    // Individual Cards
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

// --- HYBRID CHART ENGINE ---
function renderChart() {
    if (!appData.transactions.length) return;

    // Sort transactions
    const sortedTx = [...appData.transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
    
    let series = [];
    let chartType = 'line';
    let options = {};

    if (currentChartType === 'line') {
        // --- MODE 1: INDIVIDUAL LINES PER ACCOUNT ---
        chartType = 'line';
        
        // We need to build a timeline for EACH account
        const accountData = {};
        appData.accounts.forEach(acc => accountData[acc.id] = { name: acc.name, balance: 0, dataPoints: [] });

        // Iterate through history to build balance over time
        // Note: Ideally we replay history. For simplicity, we just plot points where transactions happen.
        // A smarter way: replay history day by day.
        
        // 1. Initialize balances map
        const runningBalances = {};
        appData.accounts.forEach(acc => runningBalances[acc.id] = 0);

        sortedTx.forEach(t => {
            const accId = t.account || t.from; // Handle transfer 'from'
            
            // Logic for Income/Expense
            if(t.type === 'income') runningBalances[t.account] += t.amount;
            if(t.type === 'expense') runningBalances[t.account] -= t.amount;
            
            // Logic for Transfer
            if(t.type === 'transfer') {
                runningBalances[t.from] -= t.amount;
                runningBalances[t.to] += t.amount;
                // Record point for 'to' account as well
                accountData[t.to].dataPoints.push({ x: new Date(t.date).getTime(), y: runningBalances[t.to] });
            }

            // Record point for the primary account involved
            if (accountData[accId]) {
                accountData[accId].dataPoints.push({ x: new Date(t.date).getTime(), y: runningBalances[accId] });
            }
        });

        // Convert to Apex Series
        series = Object.values(accountData).map(acc => ({
            name: acc.name,
            data: acc.dataPoints
        }));

    } else {
        // --- MODE 2: TOTAL NET WORTH CANDLES ---
        chartType = 'candlestick';
        
        let currentBalance = 0;
        const monthlyData = {}; 

        sortedTx.forEach(t => {
            const monthKey = t.date.substring(0, 7);
            let prevBalance = currentBalance;
            
            if (t.type === 'income') currentBalance += t.amount;
            if (t.type === 'expense') currentBalance -= t.amount;
            
            if (!monthlyData[monthKey]) {
                monthlyData[monthKey] = {
                    open: prevBalance, high: prevBalance, low: prevBalance, close: currentBalance
                };
            }
            const m = monthlyData[monthKey];
            if (currentBalance > m.high) m.high = currentBalance;
            if (currentBalance < m.low) m.low = currentBalance;
            m.close = currentBalance;
        });

        const dataPoints = Object.keys(monthlyData).sort().map(k => {
            const d = monthlyData[k];
            return { x: new Date(k + "-01").getTime(), y: [d.open, d.high, d.low, d.close] };
        });

        series = [{ name: 'Net Worth', data: dataPoints }];
    }

    // Chart Configuration
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    
    options = {
        series: series,
        chart: {
            type: chartType,
            height: 350,
            background: 'transparent',
            toolbar: { show: false }
        },
        theme: { mode: isDark ? 'dark' : 'light' },
        stroke: { curve: 'smooth', width: 2 },
        xaxis: { type: 'datetime' },
        yaxis: { labels: { formatter: (val) => "$" + val.toFixed(0) } },
        // Standard Red/Green for candles
        plotOptions: {
            candlestick: {
                colors: { upward: '#10b981', downward: '#ef4444' }
            }
        },
        colors: ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b'] // Line colors
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

window.switchChart = (type) => {
    currentChartType = type;
    document.getElementById('btnLine').className = type === 'line' ? 'toggle-btn active' : 'toggle-btn';
    document.getElementById('btnCandle').className = type === 'candlestick' ? 'toggle-btn active' : 'toggle-btn';
    renderChart();
};

function updateDropdowns() {
    const selects = document.querySelectorAll('.account-select');
    selects.forEach(s => {
        const old = s.value;
        s.innerHTML = appData.accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
        if(old) s.value = old;
    });
}