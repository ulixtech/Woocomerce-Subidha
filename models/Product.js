const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Product = sequelize.define('Product', {
    // Primary key for linking to order_items
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    // The unique ID provided in the source file (Bill Number's Item # / Product Id)
    product_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true, // Ensures no two product masters have the same external ID
        comment: 'External Product ID from source file (Item #/Product Id)',
    },
    item_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: 'Master descriptive name of the product',
    },
    hsn_code: {
        type: DataTypes.STRING(20),
        allowNull: true,
    },
}, {
    tableName: 'products',
    // We only track creation/update timestamps here, not in order_items
    timestamps: true, 
});

module.exports = Product;