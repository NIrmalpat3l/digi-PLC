let ws;
const connectionDot = document.getElementById('connection-dot');
const connectionText = document.getElementById('connection-text');
const container = document.getElementById('hmi-content-container');

// Dialog Elements
const dialogOverlay = document.getElementById('confirm-dialog');
const btnConfirmCancel = document.getElementById('btn-confirm-cancel');
const btnConfirmOk = document.getElementById('btn-confirm-ok');
let pendingCommand = null;

const API_KEY = "my_super_secret_key_change_in_production";
const uiElements = { toggles: {}, values: {} };

async function init() {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();
        renderUI(config);
        connectWebSocket();
    } catch (e) {
        container.innerHTML = `<div style="color:red; padding:2rem;">Failed to load UI schema. Server might be down.</div>`;
    }
}

function renderUI(config) {
    container.innerHTML = '';
    
    config.layout.forEach(panel => {
        const panelDiv = document.createElement('div');
        panelDiv.className = `panel ${panel.cssClass || ''}`;
        
        const titleDiv = document.createElement('div');
        titleDiv.className = 'panel-title';
        titleDiv.textContent = panel.panel;
        panelDiv.appendChild(titleDiv);
        
        panel.components.forEach(compGroup => {
            if (compGroup.subtitle) {
                const sub = document.createElement('div');
                sub.className = 'panel-subtitle';
                sub.style.marginTop = '1rem';
                sub.textContent = compGroup.subtitle;
                panelDiv.appendChild(sub);
            }
            
            const groupDiv = document.createElement('div');
            groupDiv.className = compGroup.group; // e.g. cycle-controls or outputs-grid
            
            if (compGroup.group === 'scada-table') {
                const table = document.createElement('table');
                table.className = 'scada-table';
                const thead = document.createElement('thead');
                const tr = document.createElement('tr');
                compGroup.headers.forEach((h, i) => {
                    const th = document.createElement('th');
                    th.textContent = h;
                    if (i > 0) th.className = 'col-val';
                    else th.className = 'col-param';
                    tr.appendChild(th);
                });
                thead.appendChild(tr);
                table.appendChild(thead);
                
                const tbody = document.createElement('tbody');
                compGroup.items.forEach(item => {
                    if (item.type === 'set-value-display') {
                        const trItem = document.createElement('tr');
                        if (item.highlight) trItem.className = 'row-highlight';
                        
                        trItem.innerHTML = `
                            <td>${item.label}</td>
                            <td class="num-cell">
                                <input type="number" id="val-${item.setPointId}" class="setpoint-input" value="0">
                            </td>
                            <td class="num-cell live-val" id="val-${item.actualPointId}">0</td>
                        `;
                        tbody.appendChild(trItem);
                        
                        const setPointInput = trItem.querySelector(`#val-${item.setPointId}`);
                        setPointInput.addEventListener('change', (e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val)) {
                                sendCommand(item.setPointId, val);
                            }
                        });
                        
                        uiElements.values[item.setPointId] = setPointInput;
                        uiElements.values[item.actualPointId] = trItem.querySelector(`#val-${item.actualPointId}`);
                    }
                });
                table.appendChild(tbody);
                groupDiv.appendChild(table);
                
            } else {
                compGroup.items.forEach(item => {
                    if (item.type === 'momentary-button') {
                        const btn = document.createElement('button');
                        btn.className = `btn-industrial btn-${item.color || 'idle'}`;
                        btn.textContent = item.label;
                        
                        btn.addEventListener('click', () => {
                            if (item.confirm) {
                                pendingCommand = { pointId: item.pointId, value: true };
                                dialogOverlay.classList.remove('hidden');
                            } else {
                                sendCommand(item.pointId, true);
                            }
                        });
                        groupDiv.appendChild(btn);
                    } else if (item.type === 'toggle') {
                        const row = document.createElement('div');
                        row.className = 'output-row';
                        row.innerHTML = `
                            <span class="label">${item.label}</span>
                            <div class="toggle-switch">
                                <input type="checkbox" id="toggle-${item.pointId}">
                                <label class="toggle-slider" for="toggle-${item.pointId}"></label>
                            </div>
                        `;
                        groupDiv.appendChild(row);
                        const toggleInput = row.querySelector('input');
                        uiElements.toggles[item.pointId] = toggleInput;
                        
                        toggleInput.addEventListener('change', (e) => {
                            sendCommand(item.pointId, e.target.checked);
                        });
                    } else if (item.type === 'software-setting') {
                        const row = document.createElement('div');
                        row.className = 'output-row';
                        row.innerHTML = `
                            <span class="label">${item.label}</span>
                            <input type="number" id="setting-${item.settingKey}" class="setpoint-input" value="${item.defaultValue}">
                        `;
                        groupDiv.appendChild(row);
                        
                        const inputElement = row.querySelector(`#setting-${item.settingKey}`);
                        inputElement.addEventListener('change', (e) => {
                            sendSetting(item.settingKey, e.target.value);
                        });
                    }
                });
            }
            
            panelDiv.appendChild(groupDiv);
        });
        
        container.appendChild(panelDiv);
    });
}

btnConfirmCancel.addEventListener('click', () => {
    dialogOverlay.classList.add('hidden');
    pendingCommand = null;
});

btnConfirmOk.addEventListener('click', () => {
    dialogOverlay.classList.add('hidden');
    if (pendingCommand) {
        sendCommand(pendingCommand.pointId, pendingCommand.value);
        pendingCommand = null;
    }
});

async function sendCommand(pointId, value) {
    try {
        const response = await fetch('/api/write', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify({ pointId, value })
        });
        const data = await response.json();
        if (!data.success) {
            alert('Command failed: ' + data.error);
        }
    } catch (error) {
        alert('Error sending command: ' + error.message);
    }
}

async function sendSetting(settingKey, value) {
    const response = await fetch('/api/settings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ [settingKey]: value })
    });
    const result = await response.json();
    if (!result.success) {
        console.error("Setting update failed");
    }
}

function connectWebSocket() {
    ws = new WebSocket(`ws://${window.location.host}/ws/live`);
    
    ws.onopen = () => console.log('WebSocket Connected');
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            updateDashboard(data);
        } catch (e) {}
    };
    
    ws.onclose = () => {
        setDisconnected();
        setTimeout(() => window.location.reload(), 5000);
    };
    
    ws.onerror = () => setDisconnected();
}

function setDisconnected() {
    connectionDot.className = 'led-indicator led-red';
    connectionText.textContent = 'COMM FAULT';
}

function updateDashboard(data) {
    if (data.status === 'connected') {
        connectionDot.className = 'led-indicator led-green';
        connectionText.textContent = 'RUNNING';
        document.getElementById('setup-dialog').classList.add('hidden');
    } else if (data.status === 'setup_required') {
        connectionDot.className = 'led-indicator led-yellow';
        connectionText.textContent = 'SETUP REQ';
        showSetupDialog();
    } else {
        setDisconnected();
    }


    if (data.values) {
        for (const [key, value] of Object.entries(data.values)) {
            if (uiElements.toggles[key]) {
                uiElements.toggles[key].checked = !!value;
            }
            if (uiElements.values[key]) {
                const el = uiElements.values[key];
                if (el.tagName === 'INPUT') {
                    if (document.activeElement !== el) {
                        el.value = value;
                    }
                } else {
                    el.textContent = value;
                }
            }
        }
    }

    if (data.system_cycle_running !== undefined) {
        const inputs = document.querySelectorAll('.setpoint-input');
        inputs.forEach(input => {
            input.disabled = data.system_cycle_running;
        });
    }
}

init();

function showSetupDialog() {
    const dialog = document.getElementById('setup-dialog');
    if (!dialog.classList.contains('hidden')) return; // Already showing
    
    dialog.classList.remove('hidden');
    const select = document.getElementById('com-port-select');
    const saveBtn = document.getElementById('btn-save-port');
    
    fetch('/api/ports')
        .then(res => res.json())
        .then(ports => {
            select.innerHTML = '';
            if (ports.length === 0) {
                select.innerHTML = '<option disabled>No COM ports found</option>';
            } else {
                ports.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.path;
                    opt.textContent = `${p.path} - ${p.friendlyName || p.manufacturer || 'Unknown Device'}`;
                    select.appendChild(opt);
                });
            }
        })
        .catch(err => {
            select.innerHTML = '<option disabled>Error loading ports</option>';
        });
        
    saveBtn.onclick = () => {
        const port = select.value;
        if (!port) return;
        saveBtn.textContent = "SAVING...";
        fetch('/api/ports/save', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ port })
        }).then(() => {
            saveBtn.textContent = "SAVE CONFIG";
            dialog.classList.add('hidden');
            connectionText.textContent = 'CONNECTING...';
        });
    };
}
