import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// --- 🔥 PASTE YOUR FIREBASE CONFIG HERE ---
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
const { jsPDF } = window.jspdf;

let currentUser = null;
let appData = { accounts: [], transactions: [] };
let chartInstance = null;

// --- THEME & AUTH ---
window.toggleTheme = () => {
    const body = document.body;
    const isDark = body.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    body.setAttribute('data-theme', newTheme);
    document.getElementById('themeIcon').className = newTheme === 'dark' ? 'ri-sun-line' : 'ri-moon-line';
    if(chartInstance) chartInstance.updateOptions({ theme: { mode: newTheme } });
};

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
    // Set Default Dates
    const today = new Date().toISOString().split('T')[0];
    ['incDate', 'expDate', 'transDate', 'reportEnd'].forEach(id => document.getElementById(id).value = today);
    
    // Set Report Start to 1st of month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    document.getElementById('reportStart').value = startOfMonth.toISOString().split('T')[0];
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
        li.innerHTML = `
            <div>
                <div style="font-weight:600">${t.reason}</div>
                <div style="font-size:0.8rem; color:var(--text-muted)">${t.date.split('T')[0]}</div>
            </div>
            <div class="${valClass}">
                ${t.type === 'expense' ? '-' : '+'}$${t.amount.toLocaleString()}
            </div>
        `;
        list.appendChild(li);
    });
}

// --- PDF GENERATOR (WITH FILTER & WALLET COLUMN) ---
window.generatePDF = () => {
    const start = new Date(document.getElementById('reportStart').value);
    const end = new Date(document.getElementById('reportEnd').value);
    const filterAccId = document.getElementById('reportAccount').value;
    
    const getAccName = (id) => {
        const acc = appData.accounts.find(a => a.id === id);
        return acc ? acc.name : 'Unknown';
    };

    const filtered = appData.transactions.filter(t => {
        const d = new Date(t.date);
        const inDateRange = d >= start && d <= end;
        let matchesAccount = true;
        
        if (filterAccId !== 'all') {
            if (t.type === 'transfer') matchesAccount = (t.from === filterAccId || t.to === filterAccId);
            else matchesAccount = (t.account === filterAccId);
        }
        return inDateRange && matchesAccount;
    }).sort((a,b) => new Date(a.date) - new Date(b.date));

    if(filtered.length === 0) return alert("No transactions found for selection.");

    const doc = new jsPDF();
    doc.setFontSize(20);
    doc.setTextColor(59, 130, 246);
    doc.text("Money Flow Statement", 14, 20);
    
    doc.setFontSize(10);
    doc.setTextColor(100);
    const walletName = filterAccId === 'all' ? "All Wallets" : getAccName(filterAccId);
    doc.text(`Period: ${start.toLocaleDateString()} to ${end.toLocaleDateString()}`, 14, 28);
    doc.text(`Wallet Scope: ${walletName}`, 14, 33);

    const tableData = filtered.map(t => {
        let accName = "";
        let amountStr = "";
        if (t.type === 'transfer') {
            accName = `${getAccName(t.from)} -> ${getAccName(t.to)}`;
            amountStr = `$${t.amount}`;
        } else {
            accName = getAccName(t.account);
            amountStr = t.type === 'expense' ? `-$${t.amount}` : `$${t.amount}`;
        }
        return [t.date.split('T')[0], accName, t.type.toUpperCase(), t.reason, amountStr];
    });

    doc.autoTable({
        startY: 40,
        head: [['Date', 'Wallet / Flow', 'Type', 'Description', 'Amount']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [59, 130, 246] },
        columnStyles: { 4: { fontStyle: 'bold', halign: 'right' } }
    });

    let totalIn = 0, totalOut = 0;
    filtered.forEach(t => {
        if(t.type === 'income') totalIn += t.amount;
        if(t.type === 'expense') totalOut += t.amount;
    });

    let finalY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text(`Total Income: $${totalIn.toLocaleString()}`, 14, finalY);
    doc.text(`Total Expense: $${totalOut.toLocaleString()}`, 70, finalY);
    doc.setTextColor(totalIn - totalOut >= 0 ? 0 : 200, 0, 0);
    doc.text(`Net Flow: $${(totalIn - totalOut).toLocaleString()}`, 140, finalY);

    doc.save(`Statement_${start.toISOString().split('T')[0]}.pdf`);
};

// --- CHART ENGINE ---
function renderChart() {
    if (!appData.transactions.length) return;
    const sortedTx = [...appData.transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
    const seriesMap = {};
    
    appData.accounts.forEach(acc => {
        seriesMap[acc.id] = { name: acc.name, bal: 0, data: [] };
    });

    sortedTx.forEach(t => {
        const timestamp = new Date(t.date).getTime();
        if (t.type === 'income') seriesMap[t.account].bal += t.amount;
        if (t.type === 'expense') seriesMap[t.account].bal -= t.amount;
        if (t.type === 'transfer') {
            seriesMap[t.from].bal -= t.amount;
            seriesMap[t.to].bal += t.amount;
            seriesMap[t.to].data.push({ x: timestamp, y: seriesMap[t.to].bal });
        }
        const mainAcc = t.account || t.from;
        if(seriesMap[mainAcc]) seriesMap[mainAcc].data.push({ x: timestamp, y: seriesMap[mainAcc].bal });
    });

    const series = Object.values(seriesMap).map(s => ({ name: s.name, data: s.data }));
    const isDark = document.body.getAttribute('data-theme') === 'dark';

    const options = {
        series: series,
        chart: {
            type: 'line', height: 350, background: 'transparent',
            toolbar: { show: false }, zoom: { enabled: false }
        },
        theme: { mode: isDark ? 'dark' : 'light' },
        stroke: { curve: 'stepline', width: 2 },
        xaxis: { type: 'datetime' },
        yaxis: { labels: { formatter: (val) => "$" + val.toFixed(0) } },
        colors: ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'],
        grid: { borderColor: isDark ? '#374151' : '#e5e7eb', strokeDashArray: 4 }
    };

    if (chartInstance) chartInstance.destroy();
    chartInstance = new ApexCharts(document.querySelector("#mainChart"), options);
    chartInstance.render();
}

// --- ACTIONS & UTILS ---
window.saveData = async () => {
    await setDoc(doc(db, "users", currentUser.uid), appData);
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
    } else { acc.balance += amount; }

    appData.transactions.push({ type, amount, reason, account: accId, date: new Date(date).toISOString() });
    document.getElementById(prefix+'Amount').value = '';
    document.getElementById(prefix+'Reason').value = '';
    await saveData();
};

window.createNewAccount = async () => {
    const name = document.getElementById('newAccountName').value;
    if(!name) return;
    appData.accounts.push({ id: 'acc_'+Date.now(), name, balance: 0 });
    document.getElementById('newAccountName').value = '';
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

    appData.transactions.push({ type: 'transfer', amount, from: fromId, to: toId, reason: 'Transfer', date: new Date(date).toISOString() });
    await saveData();
};

window.switchTab = (tab, e) => {
    document.querySelectorAll('.form-section').forEach(f => f.classList.add('hidden'));
    document.getElementById(tab+'Form').classList.remove('hidden');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
};

function updateDropdowns() {
    const selects = document.querySelectorAll('.account-select');
    const reportSelect = document.getElementById('reportAccount');
    const optionsHTML = appData.accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');

    selects.forEach(s => {
        const old = s.value;
        s.innerHTML = optionsHTML;
        if(old) s.value = old;
    });

    if(reportSelect) {
        const oldReport = reportSelect.value;
        reportSelect.innerHTML = `<option value="all">All Wallets</option>` + optionsHTML;
        if(oldReport) reportSelect.value = oldReport;
    }
}
