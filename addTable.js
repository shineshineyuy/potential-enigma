"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.addTable = addTable;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const querySql_1 = require("./querySql");
const runTerminal_1 = require("../runTerminal");
/**
 * Adds tables to the configuration by presenting a list of user-defined tables to select from
 * and runs the `dab add` and `dab update` CLI commands for each selected table.
 * @param configPath - The path to the configuration file.
 * @param connectionString - The SQL Server connection string.
 */
async function addTable(configPath, connectionString) {
    let validTables = [];
    const pool = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Loading Table Metadata...',
        cancellable: false,
    }, async (progress) => {
        progress.report({ message: 'Connecting to the database...' });
        const pool = await (0, querySql_1.openConnection)(connectionString);
        if (!pool) {
            vscode.window.showErrorMessage('Failed to connect to the database.');
            return undefined;
        }
        try {
            progress.report({ message: 'Fetching table metadata...' });
            const metadata = await (0, querySql_1.getTableMetadata)(pool);
            if (metadata.length === 0) {
                vscode.window.showInformationMessage('No user-defined tables found.');
                await pool.close();
                return undefined;
            }
            progress.report({ message: 'Loading configuration...' });
            const existingEntities = getExistingEntities(configPath);
            // Filter out tables with no primary keys or tables already in the configuration
            validTables = metadata.filter(table => table.primaryKeys &&
                table.primaryKeys.trim() !== '' &&
                !existingEntities.includes(`${table.schemaName}.${table.tableName}`));
            if (validTables.length === 0) {
                vscode.window.showErrorMessage('No new tables with primary keys found. Operation canceled.');
                await pool.close();
                return undefined;
            }
            return pool;
        }
        catch (error) {
            vscode.window.showErrorMessage(`Error adding tables: ${error}`);
            await pool.close();
            return undefined;
        }
    });
    if (!pool) {
        return;
    }
    // At this point, the progress dialog is gone, and we can show the table selection dialog
    const selectedTables = await chooseTable(validTables);
    if (!selectedTables || selectedTables.length === 0) {
        vscode.window.showInformationMessage('No tables selected.');
        await pool.close();
        return;
    }
    selectedTables.forEach(table => {
        const [schema, tableName] = table.split('.');
        const entityName = tableName;
        const source = `${schema}.${tableName}`;
        const primaryKeys = validTables.find(t => `${t.schemaName}.${t.tableName}` === table)?.primaryKeys || '';
        const allColumns = validTables.find(t => `${t.schemaName}.${t.tableName}` === table)?.allColumns || '';
        callAddTable(configPath, entityName, source, primaryKeys);
        callUpdateTable(configPath, entityName, allColumns);
    });
    vscode.window.showInformationMessage(`Added and updated tables: ${selectedTables.join(', ')}`);
    await pool.close();
}
/**
 * Loads the existing entities from the configuration file.
 * @param configPath - The path to the configuration file.
 * @returns An array of schema-qualified table names already in the configuration.
 */
function getExistingEntities(configPath) {
    try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configContent);
        if (!config.entities) {
            return [];
        }
        return Object.values(config.entities)
            .map((entity) => entity.source?.object)
            .filter((source) => source)
            .map((source) => source.replace(/[\[\]]/g, '')); // Remove brackets from source names
    }
    catch (error) {
        vscode.window.showErrorMessage(`Error reading configuration file: ${error}`);
        return [];
    }
}
/**
 * Presents a list of tables to the user and allows multiple selections.
 * @param metadata - The metadata of tables containing schemaName and tableName.
 * @returns An array of selected tables in the format "schemaName.tableName".
 */
async function chooseTable(metadata) {
    const tableOptions = metadata.map(row => `${row.schemaName}.${row.tableName}`);
    return await vscode.window.showQuickPick(tableOptions, {
        canPickMany: true,
        placeHolder: 'Select tables to add',
    });
}
/**
 * Calls the `dab add` command to add a table entity.
 * @param configPath - The path to the configuration file.
 * @param entityName - The name of the entity.
 * @param source - The schema-qualified table name.
 * @param primaryKeys - The primary key fields for the table.
 */
function callAddTable(configPath, entityName, source, primaryKeys) {
    const command = `dab add ${entityName} -c "${configPath}" --source ${source} --source.key-fields "${primaryKeys}" --rest "${entityName}" --permissions "anonymous:*"`;
    (0, runTerminal_1.runCommand)(command);
}
/**
 * Calls the `dab update` command to add mappings to the table entity.
 * @param configPath - The path to the configuration file.
 * @param entityName - The name of the entity.
 * @param allColumns - A comma-separated string of all column names.
 */
function callUpdateTable(configPath, entityName, allColumns) {
    // Generate the mapping string: "column1:column1,column2:column2"
    const mappings = allColumns.split(',').map(column => `${column}:${column}`).join(',');
    const command = `dab update ${entityName} -c "${configPath}" --map "${mappings}"`;
    (0, runTerminal_1.runCommand)(command);
}
//# sourceMappingURL=addTable.js.map