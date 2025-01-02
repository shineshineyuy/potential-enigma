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
exports.addView = addView;
const vscode = __importStar(require("vscode"));
const querySql_1 = require("./querySql");
const runTerminal_1 = require("../runTerminal");
/**
 * Adds views to the configuration by presenting a list of user-defined views to select from,
 * prompts the user for primary key fields, and runs the `dab add` and `dab update` CLI commands.
 * @param configPath - The path to the configuration file.
 * @param connectionString - The SQL Server connection string.
 */
async function addView(configPath, connectionString) {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Loading View Metadata...',
        cancellable: false,
    }, async (progress) => {
        progress.report({ message: 'Connecting to the database...' });
        const pool = await (0, querySql_1.openConnection)(connectionString);
        if (!pool) {
            vscode.window.showErrorMessage('Failed to connect to the database.');
            return;
        }
        try {
            progress.report({ message: 'Fetching view metadata...' });
            const metadata = await (0, querySql_1.getViewMetadata)(pool);
            if (metadata.length === 0) {
                vscode.window.showInformationMessage('No user-defined views found.');
                return;
            }
            // Prompt user to select a view
            const selectedView = await chooseView(metadata);
            if (!selectedView) {
                vscode.window.showInformationMessage('No view selected.');
                return;
            }
            const [schema, viewName] = selectedView.split('.');
            const entityName = viewName;
            const source = `${schema}.${viewName}`;
            // Get the columns for the selected view
            const viewColumns = metadata.find(v => `${v.schemaName}.${v.viewName}` === selectedView)?.columns || '';
            const columnList = viewColumns.split(',');
            // Prompt user to select primary key fields
            const selectedKeys = await choosePrimaryKeys(columnList);
            if (!selectedKeys || selectedKeys.length === 0) {
                vscode.window.showErrorMessage('No primary keys selected. Operation canceled.');
                return;
            }
            // Generate the primary keys and mappings
            const primaryKeys = selectedKeys.join(',');
            const allColumns = columnList.join(',');
            callAddView(configPath, entityName, source, primaryKeys);
            callUpdateView(configPath, entityName, allColumns);
            vscode.window.showInformationMessage(`Added and updated view: ${entityName}`);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Error adding views: ${error}`);
        }
        finally {
            await pool.close();
        }
    });
}
/**
 * Calls the `dab add` command to add a view entity.
 * @param configPath - The path to the configuration file.
 * @param entityName - The name of the entity.
 * @param source - The schema-qualified view name.
 * @param primaryKeys - The primary key fields for the view.
 */
function callAddView(configPath, entityName, source, primaryKeys) {
    const command = `dab add ${entityName} -c "${configPath}" --source ${source} --source.type "view" --source.key-fields "${primaryKeys}" --rest "${entityName}" --permissions "anonymous:*"`;
    (0, runTerminal_1.runCommand)(command);
}
/**
 * Calls the `dab update` command to add mappings to the view entity.
 * @param configPath - The path to the configuration file.
 * @param entityName - The name of the entity.
 * @param allColumns - A comma-separated string of all column names.
 */
function callUpdateView(configPath, entityName, allColumns) {
    const mappings = allColumns.split(',').map(column => `${column}:${column}`).join(',');
    const command = `dab update ${entityName} -c "${configPath}" --map "${mappings}"`;
    (0, runTerminal_1.runCommand)(command);
}
/**
 * Presents a list of views to the user and allows single selection.
 * @param metadata - The metadata of views containing schemaName and viewName.
 * @returns The selected view in the format "schemaName.viewName".
 */
async function chooseView(metadata) {
    const viewOptions = metadata.map(row => `${row.schemaName}.${row.viewName}`);
    return await vscode.window.showQuickPick(viewOptions, {
        placeHolder: 'Select a view to add',
    });
}
/**
 * Prompts the user to select primary key fields from a list of columns.
 * @param columns - The list of column names.
 * @returns An array of selected primary key fields.
 */
async function choosePrimaryKeys(columns) {
    return await vscode.window.showQuickPick(columns, {
        canPickMany: true,
        placeHolder: 'Select one or more columns to act as primary keys',
    });
}
//# sourceMappingURL=addView.js.map