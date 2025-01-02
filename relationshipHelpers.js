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
exports.getDatabaseRelationships = getDatabaseRelationships;
exports.addRelationshipToConfig = addRelationshipToConfig;
exports.getConfiguredEntities = getConfiguredEntities;
exports.filterValidRelationships = filterValidRelationships;
exports.isRelationshipInConfig = isRelationshipInConfig;
exports.chooseMultipleRelationships = chooseMultipleRelationships;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const runTerminal_1 = require("../runTerminal");
// Base query to retrieve relationships from the database
const BASE_RELATIONSHIP_QUERY = `
  WITH TableBase AS (
    SELECT 
        ic.object_id,
        CONCAT(schemas.name, '.', tables.name) AS table_name,
        ic.column_id,
        cols.name AS column_name
    FROM sys.tables
    JOIN sys.schemas ON tables.schema_id = schemas.schema_id
    JOIN sys.index_columns ic ON tables.object_id = ic.object_id
    JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    JOIN sys.columns cols ON ic.object_id = cols.object_id AND ic.column_id = cols.column_id
    WHERE i.is_primary_key = 1
    GROUP BY 
        ic.object_id,
        schemas.name,
        tables.name,
        ic.column_id,
        cols.name
  ),
  TableInfo AS (
    SELECT 
        object_id AS table_object_id,
        table_name,
        STRING_AGG(CAST(column_id AS VARCHAR(MAX)), ',') AS pk_column_ids,
        STRING_AGG(column_name, ',') AS pk_column_names
    FROM 
        TableBase
    GROUP BY 
        object_id,
        table_name
  ),
  RelationshipBase AS (
    SELECT DISTINCT
        fk.parent_object_id AS source_table_id,
        fk.referenced_object_id AS target_table_id,
        fkc.parent_column_id AS source_column_id,
        spc.name AS source_column_name,
        fkc.referenced_column_id AS target_column_id,
        tpc.name AS target_column_name
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
    JOIN sys.columns spc ON fkc.parent_object_id = spc.object_id AND fkc.parent_column_id = spc.column_id
    JOIN sys.columns tpc ON fkc.referenced_object_id = tpc.object_id AND fkc.referenced_column_id = tpc.column_id
  ),
  RelationshipInfo AS (
    SELECT
        source_table_id,
        target_table_id,
        STRING_AGG(CAST(source_column_id AS VARCHAR(MAX)), ',') AS source_column_ids,
        STRING_AGG(source_column_name, ',') AS source_column_names,
        STRING_AGG(CAST(target_column_id AS VARCHAR(MAX)), ',') AS target_column_ids,
        STRING_AGG(target_column_name, ',') AS target_column_names
    FROM 
        RelationshipBase
    GROUP BY
        source_table_id,
        target_table_id
  ),
  RelationshipDetails AS (
    SELECT
        OBJECT_NAME(TargetTableInfo.table_object_id) AS relationship_name,

        target_column_names,
        SourceTableInfo.table_name AS source_table_name,
        CONCAT(SourceTableInfo.table_name, '[', target_column_names, ']') AS source_display_name,
        CASE WHEN SourceTableInfo.pk_column_ids = RelationshipInfo.source_column_ids THEN 1 ELSE 0 END AS source_matches_pks,

        source_column_names,
        TargetTableInfo.table_name AS target_table_name,
        CONCAT(TargetTableInfo.table_name, '[', source_column_names, ']') AS target_display_name,
        CASE WHEN TargetTableInfo.pk_column_ids = RelationshipInfo.target_column_ids THEN 1 ELSE 0 END AS target_matches_pks

    FROM RelationshipInfo 
    JOIN TableInfo AS SourceTableInfo ON SourceTableInfo.table_object_id = RelationshipInfo.source_table_id
    JOIN TableInfo AS TargetTableInfo ON TargetTableInfo.table_object_id = RelationshipInfo.target_table_id
  )
  SELECT 
      relationship_name,
      source_table_name,	
      source_display_name,	
      source_column_names,
      target_table_name,	
      target_display_name,	
      target_column_names,
      CASE 
          WHEN source_matches_pks = 1 AND target_matches_pks = 1 THEN 'one-to-one'
          WHEN source_matches_pks = 1 THEN 'one-to-many'
          WHEN target_matches_pks = 1 THEN 'many-to-one'
          ELSE 'many-to-many'
      END AS cardinality
  FROM RelationshipDetails;
`;
/**
 * Retrieves all relationships from the database, including the columns involved and cardinality direction.
 * Resolves the source alias name from the configuration file.
 * @param pool - The SQL Server connection pool.
 * @param configPath - The path to the configuration file.
 * @returns A list of relationship metadata with columns and cardinality.
 */
async function getDatabaseRelationships(pool, configPath) {
    try {
        // Read and parse the configuration file
        const configContent = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configContent);
        const entities = config['entities'] || {};
        // Normalize table names for lookup
        const normalizeTableName = (tableName) => {
            return tableName.replace(/[\[\]]/g, '').replace(/^dbo\./i, '').toLowerCase();
        };
        const result = await pool.request().query(BASE_RELATIONSHIP_QUERY);
        // Map relationships and resolve the source and target alias names
        const relationships = result.recordset.map((record) => {
            const normalizedSourceTable = normalizeTableName(record.source_table_name);
            const normalizedTargetTable = normalizeTableName(record.target_table_name);
            // Find the alias name for the source table
            const sourceAliasName = Object.keys(entities).find((entityName) => normalizeTableName(entities[entityName].source?.object || '') === normalizedSourceTable) || record.source_table_name;
            // Find the alias name for the target table
            const targetAliasName = Object.keys(entities).find((entityName) => normalizeTableName(entities[entityName].source?.object || '') === normalizedTargetTable) || record.target_table_name;
            return {
                relationshipName: record.relationship_name,
                sourceTableName: record.source_table_name,
                sourceDisplayName: record.source_display_name,
                sourceColumnNames: record.source_column_names,
                targetTableName: record.target_table_name,
                targetDisplayName: record.target_display_name,
                targetColumnNames: record.target_column_names,
                cardinality: record.cardinality,
                sourceAliasName: sourceAliasName,
                targetAliasName: targetAliasName,
            };
        });
        return relationships;
    }
    catch (error) {
        vscode.window.showErrorMessage(`Error fetching relationship metadata: ${error}`);
        return [];
    }
}
/**
 * Adds the selected relationship to the configuration file.
 * @param configPath - The path to the configuration file.
 * @param sourceEntity - The source entity name or object name.
 * @param relationship - The relationship metadata.
 */
function addRelationshipToConfig(configPath, sourceEntity, relationship) {
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configContent);
    const entities = config['entities'] || {};
    const normalizeTableName = (tableName) => {
        return tableName.replace(/[\[\]]/g, '').toLowerCase();
    };
    // Map the source object name to the corresponding entity name in the config
    const sourceEntityName = Object.keys(entities).find((entityName) => normalizeTableName(entities[entityName].source?.object || '') === normalizeTableName(sourceEntity));
    if (!sourceEntityName) {
        vscode.window.showErrorMessage(`Source entity for object "${sourceEntity}" not found in the configuration.`);
        return;
    }
    // Map the target object name to the corresponding entity name in the config
    const targetEntityName = Object.keys(entities).find((entityName) => normalizeTableName(entities[entityName].source?.object || '') === normalizeTableName(relationship.targetTableName));
    if (!targetEntityName) {
        vscode.window.showErrorMessage(`Target entity for object "${relationship.targetTableName}" not found in the configuration.`);
        return;
    }
    // Extract the value before the first dash in cardinality
    const simplifiedCardinality = relationship.cardinality.split('-')[0];
    // Zip source and target column names together
    const sourceColumns = relationship.sourceColumnNames.split(',');
    const targetColumns = relationship.targetColumnNames.split(',');
    const zippedFields = sourceColumns.map((src, i) => `${src}:${targetColumns[i]}`).join(',');
    const relationshipName = targetEntityName;
    const command = `dab update ${sourceEntityName} --config "${configPath}" --relationship ${relationshipName} --target.entity ${targetEntityName} --cardinality ${simplifiedCardinality} --relationship.fields "${zippedFields}"`;
    (0, runTerminal_1.runCommand)(command);
    vscode.window.showInformationMessage(`Relationship "${relationshipName}" added to entity "${sourceEntityName}".`);
}
/**
 * Retrieves the list of entities from the configuration file.
 * @param configPath - The path to the configuration file.
 * @returns A list of entity names.
 */
async function getConfiguredEntities(configPath) {
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configContent);
    return Object.keys(config['entities'] || {});
}
/**
 * Filters valid relationships between entities present in the configuration file by comparing the source.object property.
 * @param entities - The list of entity names.
 * @param configPath - The path to the configuration file.
 * @param allRelationships - The list of all relationships from the database.
 * @returns A list of valid relationships.
 */
async function filterValidRelationships(entities, configPath, allRelationships) {
    const validRelationships = [];
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configContent);
    const configuredEntities = config['entities'] || {};
    const normalizeTableName = (tableName) => {
        return tableName.replace(/[\[\]]/g, '').replace(/^dbo\./i, '').toLowerCase();
    };
    const normalizedTableObjects = new Set(Object.values(configuredEntities).map((entity) => normalizeTableName(entity.source?.object || '')));
    for (const rel of allRelationships) {
        const normalizedSourceTable = normalizeTableName(rel.sourceTableName);
        const normalizedTargetTable = normalizeTableName(rel.targetTableName);
        const relAlreadyDefined = await isRelationshipInConfig(configPath, rel.sourceTableName, rel);
        if (normalizedTableObjects.has(normalizedSourceTable) && normalizedTableObjects.has(normalizedTargetTable) && !relAlreadyDefined) {
            validRelationships.push(rel);
        }
    }
    return validRelationships;
}
/**
 * Checks if the relationship already exists in the configuration file.
 * @param configPath - The path to the configuration file.
 * @param sourceEntity - The source entity name.
 * @param relationship - The relationship metadata.
 * @returns True if the relationship exists, false otherwise.
 */
async function isRelationshipInConfig(configPath, sourceEntity, relationship) {
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configContent);
    const existingRelationships = config['entities'][sourceEntity]?.['relationships'] || {};
    return Object.values(existingRelationships).some((rel) => rel['target.entity'] === relationship.targetTableName &&
        rel['source.displayName'] === relationship.sourceDisplayName &&
        rel['target.displayName'] === relationship.targetDisplayName);
}
/**
 * Prompts the user to select multiple relationships from the list.
 * @param relationships - The list of valid relationships.
 * @returns The selected relationships.
 */
async function chooseMultipleRelationships(relationships) {
    const relationshipOptions = relationships.map((rel) => ({
        label: rel.sourceAliasName,
        description: `(${rel.cardinality})`,
        detail: `${rel.sourceDisplayName} ──> ${rel.targetDisplayName}`,
        value: rel,
    }));
    const selectedOptions = await vscode.window.showQuickPick(relationshipOptions, {
        placeHolder: 'Select relationships to add',
        canPickMany: true,
    });
    if (!selectedOptions || selectedOptions.length === 0) {
        return [];
    }
    return selectedOptions.map((item) => item.value);
}
//# sourceMappingURL=relationshipHelpers.js.map