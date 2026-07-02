const fs = require('fs');
const path = require('path');
const configPath = path.join(__dirname, 'config.json');

try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    let changed = false;
    
    if (config.rules) {
        config.rules.forEach(rule => {
            if (rule.year === 1900 && rule.yearOperator === 'newer_than') {
                rule.yearOperator = 'older_than';
                changed = true;
            }
        });
    }

    if (changed) {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log('Config updated successfully.');
    } else {
        console.log('No changes needed in config.');
    }
} catch (e) {
    console.error('Error fixing config:', e);
}
