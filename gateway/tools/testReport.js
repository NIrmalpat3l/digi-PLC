const exporter = require('../logger/exporter');
const path = require('path');

const mockData = [];
const now = Date.now();
for (let i = 0; i < 50; i++) {
    mockData.push({
        timestamp: now + (i * 1000),
        output_1: i > 10 && i < 30 ? 1 : 0,
        output_2: i > 25 && i < 45 ? 1 : 0,
        output_1_running: i > 10 && i < 30 ? (i - 10) * 1000 : 0,
        output_2_running: i > 25 && i < 45 ? (i - 25) * 1000 : 0,
        output_1_set: 20000,
        output_2_set: 20000,
        delay_time_running: i < 10 ? i * 1000 : 0
    });
}

async function run() {
    try {
        const reportPath = path.join(__dirname, 'test_report.xlsx');
        await exporter.generateReport(reportPath, mockData, 'TEST_MACHINE_01');
        console.log('Report generated successfully at', reportPath);
    } catch (e) {
        console.error('Failed to generate report:', e);
    }
}

run();
