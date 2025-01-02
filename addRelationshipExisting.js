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
exports.addRelationshipExisting = addRelationshipExisting;
const vscode = __importStar(require("vscode"));
const querySql_1 = require("./querySql");
const relationshipHelpers_1 = require("./relationshipHelpers");
/**
 * Adds relationships from existing database definitions to the configuration.
 * @param configPath - The path to the configuration file.
 * @param connectionString - The SQL Server connection string.
 */
async function addRelationshipExisting(configPath, connectionString) {
    let pool;
    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Loading Relationship Metadata...',
            cancellable: false,
        }, async (progress) => {
            // Step 1: Connect to the database
            progress.report({ message: 'Connecting to the database...' });
            pool = await (0, querySql_1.openConnection)(connectionString);
            if (!pool) {
                throw new Error('Failed to connect to the database.');
            }
            // Step 2: Fetch all relationships from the database
            progress.report({ message: 'Fetching all relationships...' });
            const allRelationships = await (0, relationshipHelpers_1.getDatabaseRelationships)(pool, configPath);
            if (allRelationships.length === 0) {
                throw new Error('No relationships found in the database.');
            }
            // Step 3: Fetch entities from the configuration file
            progress.report({ message: 'Fetching entities from the configuration...' });
            const entities = await (0, relationshipHelpers_1.getConfiguredEntities)(configPath);
            if (entities.length === 0) {
                throw new Error('No entities found in the configuration file.');
            }
            // Step 4: Filter valid relationships based on the configuration
            progress.report({ message: 'Filtering valid relationships...' });
            const validRelationships = await (0, relationshipHelpers_1.filterValidRelationships)(entities, configPath, allRelationships);
            if (validRelationships.length === 0) {
                throw new Error('No valid relationships found in the database.');
            }
            // Step 5: Allow user to choose multiple relationships
            const selectedRelationships = await (0, relationshipHelpers_1.chooseMultipleRelationships)(validRelationships);
            if (!selectedRelationships || selectedRelationships.length === 0) {
                vscode.window.showInformationMessage('No relationships selected.');
                return;
            }
            // Step 6: Add selected relationships to the configuration
            for (const rel of selectedRelationships) {
                if (!(await (0, relationshipHelpers_1.isRelationshipInConfig)(configPath, rel.sourceTableName, rel))) {
                    await (0, relationshipHelpers_1.addRelationshipToConfig)(configPath, rel.sourceTableName, rel);
                }
            }
            vscode.window.showInformationMessage('Selected relationships have been added successfully.');
        });
    }
    catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : `Error adding relationships: ${error}`);
    }
    finally {
        if (pool) {
            await pool.close();
        }
    }
}
//# sourceMappingURL=addRelationshipExisting.js.map