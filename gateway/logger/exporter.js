const db = require('./db');
const xlsx = require('xlsx');
const ExcelJS = require('exceljs');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const path = require('path');
const fs = require('fs');
const paths = require('../core/paths');

class Exporter {
    constructor() {
        this.machineId = null;
        this.config = {
            downsampleBucketSec: 1
        };
        this.isExporting = false;
        this.isExporting = false;
    }

    init(machineId, config) {
        this.machineId = machineId;
        if (config) {
            this.config = { ...this.config, ...config };
        }
        console.log(`[Logger Exporter] Initialized for ${machineId}.`);
    }

    getExportFilename(timestamp, prefix) {
        const date = new Date(timestamp);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        
        const hh = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        const sec = String(date.getSeconds()).padStart(2, '0');
        
        const filenameStr = `${prefix}_${this.machineId}_${yyyy}${mm}${dd}_${hh}${min}${sec}`;
        
        return path.join(paths.datasheetsDir, `${filenameStr}.xlsx`);
    }

    downsample(readings) {
        if (readings.length === 0) return [];
        
        const bucketSizeMs = this.config.downsampleBucketSec > 0 ? this.config.downsampleBucketSec * 1000 : 0;
        
        if (bucketSizeMs === 0) {
            // No bucketing, just pivot by exact timestamp
            const buckets = {};
            for (const row of readings) {
                if (!buckets[row.timestamp]) buckets[row.timestamp] = { timestamp: row.timestamp };
                buckets[row.timestamp][row.point_id] = row.value;
            }
            const result = Object.values(buckets).sort((a, b) => a.timestamp - b.timestamp);
            let lastValues = {};
            for (const row of result) {
                for (const key of Object.keys(lastValues)) {
                    if (row[key] === undefined) row[key] = lastValues[key];
                }
                for (const key of Object.keys(row)) {
                    if (key !== 'timestamp') lastValues[key] = row[key];
                }
                const d = new Date(row.timestamp);
                row.Time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
            }
            return result;
        } else {
            // Proper Resampling (Upsample or Downsample) to exact intervals
            let minTs = Number.MAX_SAFE_INTEGER;
            let maxTs = 0;
            
            const rawBuckets = {};
            for (const row of readings) {
                const bucketTs = Math.floor(row.timestamp / bucketSizeMs) * bucketSizeMs;
                if (bucketTs < minTs) minTs = bucketTs;
                if (bucketTs > maxTs) maxTs = bucketTs;
                
                if (!rawBuckets[bucketTs]) rawBuckets[bucketTs] = {};
                rawBuckets[bucketTs][row.point_id] = row.value;
            }
            
            if (minTs > maxTs) return [];

            const result = [];
            let lastValues = {};
            
            for (let ts = minTs; ts <= maxTs; ts += bucketSizeMs) {
                const row = { timestamp: ts };
                
                // If actual data landed in this bucket, update our running state
                if (rawBuckets[ts]) {
                    for (const [key, val] of Object.entries(rawBuckets[ts])) {
                        lastValues[key] = val;
                    }
                }
                
                // Fill row with current state
                for (const [key, val] of Object.entries(lastValues)) {
                    row[key] = val;
                }
                
                const d = new Date(ts);
                row.Time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
                result.push(row);
            }
            
            return result;
        }
    }

    async runCycleExport() {
        if (this.isExporting || !this.machineId) return;
        this.isExporting = true;

        try {
            // Fetch all readings (since DB is wiped per cycle, > 0 gets everything)
            const newReadings = await db.getReadingsAfter(this.machineId, 0);
            
            if (newReadings.length === 0) {
                console.log('[Logger Exporter] Cycle had no data. Skipping export.');
                return;
            }

            // Always pivot data, whether downsampled or raw
            let dataToWrite = this.downsample(newReadings);
            
            if (dataToWrite.length === 0) return;
            
            // Determine filename using cycle end timestamp (now)
            const timestamp = Date.now();
            const rawFilepath = this.getExportFilename(timestamp, 'RawData');
            const summaryFilepath = this.getExportFilename(timestamp, 'Summary');
            const reportFilepath = this.getExportFilename(timestamp, 'Report');
            
            // Generate Excel file
            this.createExcel(rawFilepath, summaryFilepath, dataToWrite);

            // Generate Standalone Report with Timeline Chart
            await this.generateReport(reportFilepath, dataToWrite, this.machineId);
            
            console.log(`[Logger Exporter] Successfully exported rows to datasheets directory.`);

            // Clear DB after successful export
            await db.clearDatabase();
            console.log('[Logger Exporter] Database wiped for next cycle.');

        } catch (error) {
            console.error('[Logger Exporter] Error during cycle export:', error.message);
        } finally {
            this.isExporting = false;
        }
    }

    createExcel(rawFilepath, summaryFilepath, pivotedRows) {
        if (pivotedRows.length === 0) return;

        // --- 1. PREPARE RAW DATA SHEET ---
        // Identify setpoint parameters (keys ending with '_set') from the last row to ensure all keys are populated
        const lastRow = pivotedRows[pivotedRows.length - 1];
        const setpointKeys = Object.keys(lastRow).filter(k => k.endsWith('_set'));
        
        const headerBlock = [
            ["CYCLE PARAMETERS"],
            ["Parameter", "Value"]
        ];
        
        for (const key of setpointKeys) {
            if (lastRow[key] !== undefined) {
                headerBlock.push([key, lastRow[key]]);
            }
        }
        
        headerBlock.push([]);
        headerBlock.push(["TIME SERIES DATA"]);
        
        const timeSeriesRows = pivotedRows.map(row => {
            const copy = { ...row };
            delete copy.timestamp;
            for (const key of setpointKeys) {
                delete copy[key];
            }
            return copy;
        });
        
        const timeSeriesCols = Object.keys(timeSeriesRows[timeSeriesRows.length - 1] || {});
        headerBlock.push(timeSeriesCols);
        
        for (const row of timeSeriesRows) {
            const rowData = timeSeriesCols.map(col => row[col]);
            headerBlock.push(rowData);
        }

        const wbRaw = xlsx.utils.book_new();
        const wsData = xlsx.utils.aoa_to_sheet(headerBlock);
        
        if (!wsData['!merges']) wsData['!merges'] = [];
        wsData['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } });
        wsData['!merges'].push({ s: { r: setpointKeys.length + 3, c: 0 }, e: { r: setpointKeys.length + 3, c: timeSeriesCols.length > 0 ? timeSeriesCols.length - 1 : 1 } });
        
        xlsx.utils.book_append_sheet(wbRaw, wsData, "CycleData");
        xlsx.writeFile(wbRaw, rawFilepath);

        // --- 2. PREPARE SUMMARY SHEET ---
        const summaryRows = [
            ["Date", "Time", "Stage / Output", "Set Value (s)", "Running Time (s)"]
        ];

        const runningKeys = Object.keys(lastRow).filter(k => k.endsWith('_running'));

        for (let i = 0; i < pivotedRows.length; i++) {
            const row = pivotedRows[i];
            
            // Detect active outputs
            let activeOutputs = [];
            for (const key of Object.keys(row)) {
                if ((key.startsWith('output_') || key.startsWith('Output')) && !key.includes('_set') && !key.includes('_running') && (row[key] === 1 || row[key] === true)) {
                    activeOutputs.push(key);
                }
            }

            let currentOutputOn = 'idle';
            if (activeOutputs.length > 0) {
                currentOutputOn = activeOutputs.join(', ');
            } else if (row['delay_time_running'] > 0) {
                currentOutputOn = 'delay_time';
            }
            
            let currentSetValue = 0;
            let currentRunningTime = 0;

            if (currentOutputOn !== 'idle') {
                const primaryOutput = currentOutputOn.split(', ')[0];
                const matchingSetKey = setpointKeys.find(k => k.startsWith(primaryOutput) || k.includes(primaryOutput));
                if (matchingSetKey && row[matchingSetKey] !== undefined) {
                    currentSetValue = row[matchingSetKey];
                }
                
                const outputs = currentOutputOn.split(', ');
                for (const output of outputs) {
                    const matchingRunKey = runningKeys.find(k => k.startsWith(output) || k.includes(output));
                    if (matchingRunKey && row[matchingRunKey] !== undefined && row[matchingRunKey] > currentRunningTime) {
                        currentRunningTime = row[matchingRunKey];
                    }
                }
            }

            const dateObj = new Date(row.timestamp);
            const timeString = `${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}:${String(dateObj.getSeconds()).padStart(2, '0')}.${String(dateObj.getMilliseconds()).padStart(3, '0')}`;
            
            summaryRows.push([
                dateObj.toLocaleDateString(),
                timeString,
                currentOutputOn,
                (currentSetValue / 1000).toFixed(2),
                (currentRunningTime / 1000).toFixed(2)
            ]);
        }

        const wbSummary = xlsx.utils.book_new();
        const wsSummary = xlsx.utils.aoa_to_sheet(summaryRows);
        xlsx.utils.book_append_sheet(wbSummary, wsSummary, "Summary");
        xlsx.writeFile(wbSummary, summaryFilepath);
    }

    async generateReport(reportFilepath, pivotedRows, machineId) {
        if (pivotedRows.length === 0) return;

        const seriesData = {};
        const timestamps = pivotedRows.map(r => new Date(r.timestamp));
        const labels = timestamps.map(d => d.toLocaleTimeString());

        const lastRow = pivotedRows[pivotedRows.length - 1];
        const outputKeys = Object.keys(lastRow).filter(k => (k.startsWith('output_') || k.startsWith('Output')) && !k.includes('_set') && !k.includes('_running'));
        const runningKeys = Object.keys(lastRow).filter(k => k.endsWith('_running'));

        for (const outKey of outputKeys) {
            const runKey = runningKeys.find(k => k.startsWith(outKey) || k.includes(outKey));
            if (runKey) {
                seriesData[outKey] = { runKey, data: [] };
            }
        }
        if (runningKeys.includes('delay_time_running')) {
            seriesData['delay_time'] = { runKey: 'delay_time_running', data: [] };
        }

        for (const row of pivotedRows) {
            for (const [sName, sInfo] of Object.entries(seriesData)) {
                let isActive = false;
                if (sName === 'delay_time') {
                    isActive = row[sInfo.runKey] > 0;
                } else {
                    isActive = (row[sName] === 1 || row[sName] === true);
                }

                if (isActive && row[sInfo.runKey] !== undefined) {
                    sInfo.data.push(row[sInfo.runKey] / 1000);
                } else {
                    sInfo.data.push(null);
                }
            }
        }

        const width = 1200;
        const height = 600;
        const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour: 'white' });

        const colors = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
        
        const hexToRgba = (hex, alpha) => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        };

        const datasets = Object.keys(seriesData).map((sName, idx) => {
            const baseColor = colors[idx % colors.length];
            return {
                label: sName,
                data: seriesData[sName].data,
                borderColor: baseColor,
                backgroundColor: hexToRgba(baseColor, 0.15),
                borderWidth: 2,
                fill: true,
                tension: 0.2,
                spanGaps: false,
                pointRadius: 0,
                pointHoverRadius: 4
            };
        });

        const roundedFramePlugin = {
            id: 'roundedFrame',
            beforeDraw(chart) {
                const { ctx, width, height } = chart;
                ctx.save();
                
                ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
                ctx.shadowBlur = 15;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 4;
                
                ctx.fillStyle = '#ffffff';
                ctx.strokeStyle = '#e5e7eb';
                ctx.lineWidth = 1;
                
                const radius = 12;
                ctx.beginPath();
                ctx.moveTo(radius + 2, 2);
                ctx.lineTo(width - radius - 2, 2);
                ctx.quadraticCurveTo(width - 2, 2, width - 2, radius + 2);
                ctx.lineTo(width - 2, height - radius - 2);
                ctx.quadraticCurveTo(width - 2, height - 2, width - radius - 2, height - 2);
                ctx.lineTo(radius + 2, height - 2);
                ctx.quadraticCurveTo(2, height - 2, 2, height - radius - 2);
                ctx.lineTo(2, radius + 2);
                ctx.quadraticCurveTo(2, 2, radius + 2, 2);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                
                ctx.shadowColor = 'transparent';
                ctx.restore();
            }
        };

        const segmentLabelPlugin = {
            id: 'segmentLabels',
            afterDatasetsDraw(chart, args, options) {
                const { ctx } = chart;
                ctx.font = 'bold 12px "Inter", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                
                chart.data.datasets.forEach((dataset, i) => {
                    const meta = chart.getDatasetMeta(i);
                    ctx.fillStyle = dataset.borderColor;
                    
                    let inSegment = false;
                    let segmentStartIdx = -1;
                    
                    for (let j = 0; j <= dataset.data.length; j++) {
                        const val = j < dataset.data.length ? dataset.data[j] : null;
                        if (val !== null) {
                            if (!inSegment) {
                                inSegment = true;
                                segmentStartIdx = j;
                            }
                        } else {
                            if (inSegment) {
                                const midIdx = Math.floor((segmentStartIdx + j - 1) / 2);
                                const point = meta.data[midIdx];
                                if (point) {
                                    ctx.fillText(dataset.label, point.x, point.y - 12);
                                }
                                inSegment = false;
                            }
                        }
                    }
                });
            }
        };

        const configuration = {
            type: 'line',
            data: { labels: labels, datasets: datasets },
            options: {
                responsive: false,
                animation: false,
                layout: { padding: 24 },
                scales: {
                    x: {
                        grid: { display: false },
                        title: { display: true, text: 'Time', font: { weight: 'bold', family: '"Inter", sans-serif' } },
                        ticks: { maxTicksLimit: 12, font: { family: '"Inter", sans-serif' } }
                    },
                    y: {
                        grid: { color: '#f3f4f6' },
                        title: { display: true, text: 'Running Time (seconds)', font: { weight: 'bold', family: '"Inter", sans-serif' } },
                        beginAtZero: true,
                        ticks: { font: { family: '"Inter", sans-serif' } }
                    }
                },
                plugins: {
                    legend: { 
                        position: 'top',
                        labels: { font: { family: '"Inter", sans-serif', size: 13 }, usePointStyle: true, boxWidth: 8 }
                    },
                    title: { 
                        display: true, 
                        text: `Cycle Timeline - ${machineId}`, 
                        font: { size: 18, family: '"Inter", sans-serif', weight: 'bold' },
                        padding: { bottom: 20 }
                    }
                }
            },
            plugins: [roundedFramePlugin, segmentLabelPlugin]
        };

        const imageBuffer = await chartJSNodeCanvas.renderToBuffer(configuration);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Report', { views: [{ showGridLines: false }] });

        sheet.getColumn('A').width = 4;
        sheet.getColumn('B').width = 22;
        sheet.getColumn('C').width = 35;
        sheet.getColumn('D').width = 4;
        sheet.getColumn('E').width = 22;
        sheet.getColumn('F').width = 22;

        sheet.mergeCells('B2:C3');
        const titleCell = sheet.getCell('B2');
        titleCell.value = 'PRODUCTION CYCLE REPORT';
        titleCell.font = { size: 22, bold: true, color: { argb: 'FF1F2937' }, name: 'Segoe UI' };
        titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
        
        sheet.getCell('B4').border = { bottom: { style: 'thick', color: { argb: 'FF0EA5E9' } } };
        sheet.getCell('C4').border = { bottom: { style: 'thick', color: { argb: 'FF0EA5E9' } } };
        
        sheet.mergeCells('E2:F3');
        const logoCell = sheet.getCell('E2');
        logoCell.value = '[ COMPANY LOGO ]';
        logoCell.font = { size: 12, italic: true, color: { argb: 'FF9CA3AF' } };
        logoCell.alignment = { vertical: 'middle', horizontal: 'right' };
        
        const startRow = 6;
        sheet.getCell(`B${startRow}`).value = 'Machine ID';
        sheet.getCell(`C${startRow}`).value = machineId;
        
        sheet.getCell(`B${startRow + 1}`).value = 'Status';
        sheet.getCell(`C${startRow + 1}`).value = 'SUCCESS';
        sheet.getCell(`C${startRow + 1}`).font = { bold: true, color: { argb: 'FF047857' } };
        sheet.getCell(`C${startRow + 1}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };

        sheet.getCell(`B${startRow + 2}`).value = 'Start Time';
        sheet.getCell(`C${startRow + 2}`).value = timestamps[0].toLocaleString();
        
        sheet.getCell(`B${startRow + 3}`).value = 'End Time';
        sheet.getCell(`C${startRow + 3}`).value = timestamps[timestamps.length - 1].toLocaleString();
        
        const durationSec = ((timestamps[timestamps.length - 1] - timestamps[0]) / 1000).toFixed(1);
        sheet.getCell(`B${startRow + 4}`).value = 'Total Duration';
        sheet.getCell(`C${startRow + 4}`).value = `${durationSec} s`;

        for (let i = startRow; i <= startRow + 4; i++) {
            ['B', 'C'].forEach(col => {
                const cell = sheet.getCell(`${col}${i}`);
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                    left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                    bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                    right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
                };
                cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
                if (col === 'B') {
                    cell.font = { bold: true, color: { argb: 'FF4B5563' }, name: 'Segoe UI' };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
                } else if (col === 'C' && i !== startRow + 1) {
                    cell.font = { color: { argb: 'FF1F2937' }, name: 'Segoe UI' };
                }
            });
        }

        const imageId = workbook.addImage({ buffer: imageBuffer, extension: 'png' });
        sheet.addImage(imageId, { tl: { col: 1, row: 12 }, ext: { width: 1000, height: 500 } });

        const summaryStartRow = 44;
        
        sheet.getCell(`B${summaryStartRow}`).value = 'CYCLE SUMMARY';
        sheet.getCell(`B${summaryStartRow}`).font = { size: 14, bold: true, color: { argb: 'FF1F2937' }, name: 'Segoe UI' };
        
        const summaryHeaders = ["Date", "Time", "Stage / Output", "Set Value (s)", "Running Time (s)"];
        const headerRowIdx = summaryStartRow + 2;
        
        summaryHeaders.forEach((header, idx) => {
            const col = String.fromCharCode(66 + idx);
            const cell = sheet.getCell(`${col}${headerRowIdx}`);
            cell.value = header;
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Segoe UI' };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = { top: { style: 'thin', color: { argb: 'FF4B5563' } }, bottom: { style: 'thin', color: { argb: 'FF4B5563' } } };
        });

        const setpointKeys = Object.keys(lastRow).filter(k => k.endsWith('_set'));
        let currentRowIdx = headerRowIdx + 1;
        
        for (let i = 0; i < pivotedRows.length; i++) {
            const row = pivotedRows[i];
            
            let activeOutputs = [];
            for (const key of Object.keys(row)) {
                if ((key.startsWith('output_') || key.startsWith('Output')) && !key.includes('_set') && !key.includes('_running') && (row[key] === 1 || row[key] === true)) {
                    activeOutputs.push(key);
                }
            }

            let currentOutputOn = 'idle';
            if (activeOutputs.length > 0) {
                currentOutputOn = activeOutputs.join(', ');
            } else if (row['delay_time_running'] > 0) {
                currentOutputOn = 'delay_time';
            }
            
            let currentSetValue = 0;
            let currentRunningTime = 0;

            if (currentOutputOn !== 'idle') {
                const primaryOutput = currentOutputOn.split(', ')[0];
                const matchingSetKey = setpointKeys.find(k => k.startsWith(primaryOutput) || k.includes(primaryOutput));
                if (matchingSetKey && row[matchingSetKey] !== undefined) {
                    currentSetValue = row[matchingSetKey];
                }
                
                const outputs = currentOutputOn.split(', ');
                for (const output of outputs) {
                    const matchingRunKey = runningKeys.find(k => k.startsWith(output) || k.includes(output));
                    if (matchingRunKey && row[matchingRunKey] !== undefined && row[matchingRunKey] > currentRunningTime) {
                        currentRunningTime = row[matchingRunKey];
                    }
                }
            }

            const dateObj = new Date(row.timestamp);
            const timeString = `${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}:${String(dateObj.getSeconds()).padStart(2, '0')}.${String(dateObj.getMilliseconds()).padStart(3, '0')}`;
            
            const rowData = [
                dateObj.toLocaleDateString(),
                timeString,
                currentOutputOn,
                (currentSetValue / 1000).toFixed(2),
                (currentRunningTime / 1000).toFixed(2)
            ];

            const isEven = (currentRowIdx - headerRowIdx) % 2 === 0;
            
            rowData.forEach((val, idx) => {
                const col = String.fromCharCode(66 + idx);
                const cell = sheet.getCell(`${col}${currentRowIdx}`);
                cell.value = val;
                cell.font = { color: { argb: 'FF1F2937' }, name: 'Segoe UI' };
                cell.alignment = { vertical: 'middle', horizontal: idx > 1 ? 'center' : 'left', indent: idx <= 1 ? 1 : 0 };
                
                if (isEven) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
                }
                
                cell.border = { left: { style: 'thin', color: { argb: 'FFE5E7EB' } }, right: { style: 'thin', color: { argb: 'FFE5E7EB' } }, bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
            });
            
            currentRowIdx++;
        }

        await workbook.xlsx.writeFile(reportFilepath);
    }
}

module.exports = new Exporter();
