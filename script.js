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
                accounts: [{ id: 'acc_cash', name: 'Cash', balance: 0, cycleStart: null, cycleEnd: null, cycleIncome: 0 }],
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
            checkAndAutoUpdateCycles();
            updateUI();
        }
    });
    
    // Default Dates
    const today = new Date().toISOString().split('T')[0];
    ['expDate', 'transDate', 'reportEnd'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = today;
    });

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    document.getElementById('reportStart').value = startOfMonth.toISOString().split('T')[0];
}

function checkAndAutoUpdateCycles() {
    let updated = false;
    const now = new Date();

    appData.accounts.forEach(acc => {
        if (acc.cycleEnd) {
            let endDate = new Date(acc.cycleEnd);
            while (now >= endDate) {
                let newStart = new Date(endDate);
                let newEnd = new Date(newStart);
                newEnd.setMonth(newEnd.getMonth() + 1);

                acc.cycleStart = newStart.toISOString();
                acc.cycleEnd = newEnd.toISOString();
                acc.cycleIncome = 0;
                endDate = newEnd;
                updated = true;
            }
        }
    });

    if (updated) saveData();
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
        let spendBarHTML = '';

        if (acc.cycleStart && acc.cycleEnd) {
            const startDate = new Date(acc.cycleStart);
            const endDate = new Date(acc.cycleEnd);
            const now = new Date();
            
            const daysRemaining = Math.max(1, Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)));
            const dailyAvailable = Math.max(0, acc.balance) / daysRemaining;

            let usagePercent = 0;
            if (acc.cycleIncome > 0) {
                const totalExpenses = appData.transactions
                    .filter(t => t.account === acc.id && t.type === 'expense' && new Date(t.date) >= startDate && new Date(t.date) < endDate)
                    .reduce((sum, t) => sum + t.amount, 0);
                usagePercent = Math.min(100, Math.round((totalExpenses / acc.cycleIncome) * 100));
            }

            const barColor = usagePercent > 90 ? 'var(--danger)' : (usagePercent > 75 ? '#f59e0b' : 'var(--success)');

            spendBarHTML = `
                <div class="spend-bar-container">
                    <div class="spend-info">
                        <span><strong>Available:</strong> $${dailyAvailable.toFixed(0)}/day</span>
                        <span><strong>Days Left:</strong> ${daysRemaining} days</span>
                    </div>
                    <div class="progress-bg">
                        <div class="progress-fill" style="width: ${usagePercent}%; background-color: ${barColor};"></div>
                    </div>
                    <div class="cycle-footer">
                        <span>Cycle: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}</span>
                        <button class="cycle-edit-btn" onclick="openCycleModal('${acc.id}', '${startDate.toISOString().split('T')[0]}', '${endDate.toISOString().split('T')[0]}')">
                            <i class="ri-edit-line"></i> Edit
                        </button>
                    </div>
                </div>
            `;
        } else {
            spendBarHTML = `
                <div style="margin-top:10px;">
                    <button class="cycle-edit-btn" style="width:100%; text-align:center;" onclick="openCycleModal('${acc.id}', '${new Date().toISOString().split('T')[0]}', '')">
                        + Set Spend Cycle Dates
                    </button>
                </div>
            `;
        }

        container.innerHTML += `
            <div class="card">
                <h3 style="margin:0; font-size:0.9rem; color:var(--text-muted)">${acc.name}</h3>
                <div class="amount">$${acc.balance.toLocaleString()}</div>
                ${spendBarHTML}
            </div>`;
    });
}

// --- CYCLE MODAL FUNCTIONS ---
window.openCycleModal = (accId, start, end) => {
    document.getElementById('modalAccId').value = accId;
    document.getElementById('modalCycleStart').value = start || new Date().toISOString().split('T')[0];
    
    if (!end) {
        const d = new Date();
        d.setMonth(d.getMonth() + 1);
        end = d.toISOString().split('T')[0];
    }
    document.getElementById('modalCycleEnd').value = end;
    document.getElementById('cycleModal').classList.remove('hidden');
};

window.closeCycleModal = () => {
    document.getElementById('cycleModal').classList.add('hidden');
};

window.saveCycleDates = async () => {
    const accId = document.getElementById('modalAccId').value;
    const startVal = document.getElementById('modalCycleStart').value;
    const endVal = document.getElementById('modalCycleEnd').value;

    if (!startVal || !endVal) return alert("Please select both start and end dates.");
    if (new Date(startVal) >= new Date(endVal)) return alert("End date must be after start date.");

    const acc = appData.accounts.find(a => a.id === accId);
    if (acc) {
        acc.cycleStart = new Date(startVal).toISOString();
        acc.cycleEnd = new Date(endVal).toISOString();
        await saveData();
        closeCycleModal();
        updateUI();
    }
};

function renderHistory() {
    const list = document.getElementById('historyList');
    list.innerHTML = '';
    const sortedTx = appData.transactions.map((t, idx) => ({ ...t, originalIndex: idx })).sort((a,b) => new Date(b.date) - new Date(a.date));
    const recent = sortedTx.slice(0, 10);

    recent.forEach(t => {
        const li = document.createElement('li');
        li.className = 'history-item';
        let valClass = t.type === 'income' ? 'val-green' : (t.type === 'expense' ? 'val-red' : '');
        li.innerHTML = `
            <div>
                <div style="font-weight:600">${t.reason}</div>
                <div style="font-size:0.8rem; color:var(--text-muted)">${t.date.split('T')[0]}</div>
            </div>
            <div style="display:flex; align-items:center; gap:12px;">
                <div class="${valClass}">
                    ${t.type === 'expense' ? '-' : '+'}$${t.amount.toLocaleString()}
                </div>
                <button class="rollback-btn" onclick="rollbackTransaction(${t.originalIndex})" title="Rollback Transaction">
                    <i class="ri-history-line"></i>
                </button>
            </div>
        `;
        list.appendChild(li);
    });
}

// --- ROLLBACK FEATURE ---
window.rollbackTransaction = async (index) => {
    if (!confirm("Are you sure you want to rollback this transaction?")) return;

    const t = appData.transactions[index];
    if (!t) return;

    if (t.type === 'income') {
        const acc = appData.accounts.find(a => a.id === t.account);
        if (acc) {
            acc.balance -= t.amount;
            if (acc.cycleIncome) acc.cycleIncome = Math.max(0, acc.cycleIncome - t.amount);
        }
    } else if (t.type === 'expense') {
        const acc = appData.accounts.find(a => a.id === t.account);
        if (acc) acc.balance += t.amount;
    } else if (t.type === 'transfer') {
        const fromAcc = appData.accounts.find(a => a.id === t.from);
        const toAcc = appData.accounts.find(a => a.id === t.to);
        if (fromAcc) fromAcc.balance += t.amount;
        if (toAcc) toAcc.balance -= t.amount;
    }

    appData.transactions.splice(index, 1);
    await saveData();
};

// --- PDF GENERATOR ---
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

// --- CHART ENGINE WITH ANALYTICS ---
function renderChart() {
    if (!appData.transactions.length) return;
    const sortedTx = [...appData.transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
    const seriesMap = {};
    
    appData.accounts.forEach(acc => {
        seriesMap[acc.id] = { name: acc.name, bal: 0, data: [] };
    });

    let totalIn = 0, totalOut = 0;

    sortedTx.forEach(t => {
        const timestamp = new Date(t.date).getTime();
        if (t.type === 'income') {
            seriesMap[t.account].bal += t.amount;
            totalIn += t.amount;
        }
        if (t.type === 'expense') {
            seriesMap[t.account].bal -= t.amount;
            totalOut += t.amount;
        }
        if (t.type === 'transfer') {
            if (seriesMap[t.from]) seriesMap[t.from].bal -= t.amount;
            if (seriesMap[t.to]) {
                seriesMap[t.to].bal += t.amount;
                seriesMap[t.to].data.push({ x: timestamp, y: seriesMap[t.to].bal });
            }
        }
        const mainAcc = t.account || t.from;
        if(seriesMap[mainAcc]) seriesMap[mainAcc].data.push({ x: timestamp, y: seriesMap[mainAcc].bal });
    });

    const savingsRate = totalIn > 0 ? Math.max(0, Math.round(((totalIn - totalOut) / totalIn) * 100)) : 0;
    const analyticsContainer = document.getElementById('chartAnalytics');
    if (analyticsContainer) {
        analyticsContainer.innerHTML = `
            <div class="analytics-pill"><span class="label">In:</span> <span class="val-green">+$${totalIn.toLocaleString()}</span></div>
            <div class="analytics-pill"><span class="label">Out:</span> <span class="val-red">-$${totalOut.toLocaleString()}</span></div>
            <div class="analytics-pill"><span class="label">Savings Rate:</span> <strong>${savingsRate}%</strong></div>
        `;
    }

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
    const accId = document.getElementById(prefix+'Account').value;
    const reason = document.getElementById(prefix+'Reason').value;
    
    // Expenses require explicit date picker input
    let dateStr = type === 'expense' ? document.getElementById('expDate').value : new Date().toISOString().split('T')[0];

    if(!amount || !reason) return alert("Fill all fields");
    const acc = appData.accounts.find(a => a.id === accId);

    if(type === 'expense') {
        if(acc.balance < amount) return alert("Insufficient Funds");
        acc.balance -= amount;
    } else { 
        acc.balance += amount;
        acc.cycleIncome = (acc.cycleIncome || 0) + amount;
    }

    appData.transactions.push({ type, amount, reason, account: accId, date: new Date(dateStr).toISOString() });
    document.getElementById(prefix+'Amount').value = '';
    document.getElementById(prefix+'Reason').value = '';
    await saveData();
};

window.createNewAccount = async () => {
    const name = document.getElementById('newAccountName').value;
    if(!name) return;
    appData.accounts.push({ id: 'acc_'+Date.now(), name, balance: 0, cycleStart: null, cycleEnd: null, cycleIncome: 0 });
    document.getElementById('newAccountName').value = '';
    await saveData();
};

window.transferMoney = async () => {
    const amount = parseFloat(document.getElementById('transAmount').value);
    const dateStr = document.getElementById('transDate').value;
    const fromId = document.getElementById('transFrom').value;
    const toId = document.getElementById('transTo').value;

    if(!amount || fromId === toId || !dateStr) return alert("Invalid Transfer");
    const fromAcc = appData.accounts.find(a => a.id === fromId);
    const toAcc = appData.accounts.find(a => a.id === toId);

    if(fromAcc.balance < amount) return alert("Insufficient Funds");
    fromAcc.balance -= amount;
    toAcc.balance += amount;

    appData.transactions.push({ type: 'transfer', amount, from: fromId, to: toId, reason: 'Transfer', date: new Date(dateStr).toISOString() });
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
