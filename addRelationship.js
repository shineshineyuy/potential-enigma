"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addRelationship = addRelationship;
const readConfig_1 = require("../readConfig");
const addRelationshipExisting_1 = require("./addRelationshipExisting");
/**
 * Adds relationships to the configuration by prompting the user to choose between database-defined or custom relationships.
 * @param configPath - The path to the configuration file.
 * @param connectionString - The SQL Server connection string.
 */
async function addRelationship(configPath, connectionString) {
    if (!(0, readConfig_1.validateConfigPath)(configPath)) {
        return;
    }
    await (0, addRelationshipExisting_1.addRelationshipExisting)(configPath, connectionString);
}
//# sourceMappingURL=addRelationship.js.map