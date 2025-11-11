// services/purgeService.js (FINAL VERSION)

const { sequelize } = require('../config/db');
const { Customer, Order, OrderItem, Product } = require('../models'); 

/**
 * Deletes all data from the primary application tables.
 * Disables foreign key checks temporarily to allow TRUNCATE to work correctly.
 */
async function purgeAllData() {
    // Define the tables in order of deletion (children first)
    const tables = [OrderItem, Order, Customer, Product];
    
    // Use a transaction to ensure atomicity for the check disabling/enabling
    const t = await sequelize.transaction();

    try {
        // 1. Temporarily disable foreign key checks
        await sequelize.query('SET FOREIGN_KEY_CHECKS = 0', { transaction: t });
        
        for (const table of tables) {
            // 2. Truncate each table to delete all data and reset auto-increment counters
            await table.truncate({ transaction: t, cascade: true, restartIdentity: true });
        }

        // 3. Re-enable foreign key checks
        await sequelize.query('SET FOREIGN_KEY_CHECKS = 1', { transaction: t });

        // 4. Commit the transaction
        await t.commit();
        
        return { success: true, message: "All order, customer, product, and item data has been successfully deleted." };

    } catch (error) {
        // Rollback the transaction if anything failed
        await t.rollback();
        // Ensure foreign key checks are re-enabled even if the purge fails
        await sequelize.query('SET FOREIGN_KEY_CHECKS = 1'); 

        console.error("Database purge failed:", error);
        return { success: false, message: `Failed to purge data due to a database error: ${error.message}. Foreign key checks have been re-enabled.` };
    }
}

module.exports = { purgeAllData };