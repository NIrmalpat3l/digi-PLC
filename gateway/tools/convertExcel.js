const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

function convertExcelToPoints(excelFilePath, outputJsonPath) {
    console.log(`Reading Excel file: ${excelFilePath}`);
    const wb = xlsx.readFile(excelFilePath);
    const sheetName = wb.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(wb.Sheets[sheetName]);

    const points = [];

    data.forEach(row => {
        const desc = row['Description'] || '';
        const modbusAddress = parseInt(row['Modbus adress']);
        const prefix = parseInt(row['Prefix']);
        const dataTypeStr = row['Data type'] || '';
        
        if (isNaN(modbusAddress)) return;

        // Auto-detect type from prefix and data type
        let modbusType = '';
        if (prefix === 0) modbusType = 'coil';
        else if (prefix === 3) modbusType = 'inputRegister';
        else if (prefix === 4) modbusType = 'holdingRegister';

        let dataType = 'bool';
        if (dataTypeStr.includes('32bit')) dataType = '32bit';
        else if (dataTypeStr.includes('16bit') || dataTypeStr.includes('Word')) dataType = '16bit';
        
        // Infer momentary based on description
        let behavior = 'standard';
        if (desc.toLowerCase().includes('momentary')) behavior = 'momentary';

        // Convert to 0-indexed if it's a coil (Modbus standard is often 0-indexed on the wire)
        // Selec PLC specifically has coils 1-indexed in manual, so we subtract 1.
        let wireAddress = modbusAddress;
        if (modbusType === 'coil') {
            wireAddress = modbusAddress - 1; 
        }

        // Generate a machine-friendly ID
        let id = desc.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/_$/, '').toLowerCase();
        
        points.push({
            id: id,
            name: desc,
            modbusType: modbusType,
            dataType: dataType,
            behavior: behavior,
            address: wireAddress,
            originalAddress: modbusAddress,
            prefix: prefix
        });
    });

    const outputDir = path.dirname(outputJsonPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputJsonPath, JSON.stringify(points, null, 2));
    console.log(`Successfully generated points configuration at: ${outputJsonPath}`);
    console.log(`Generated ${points.length} points.`);
}

// Default execution for Selec Twix-1
const inputPath = path.join(__dirname, '../../Twix-1 data details for SCADA.XLSX');
const outputPath = path.join(__dirname, '../machines/selec_twix1/points.json');

if (fs.existsSync(inputPath)) {
    convertExcelToPoints(inputPath, outputPath);
} else {
    console.error(`Excel file not found at: ${inputPath}`);
}
