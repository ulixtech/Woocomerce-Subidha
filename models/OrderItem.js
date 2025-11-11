const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const OrderItem = sequelize.define('OrderItem', {
    // Note: Foreign Keys (orderId and productId) will be defined in models/index.js

    // We keep the Item # from the invoice for reconciliation/raw data integrity
    item_hash: {
        type: DataTypes.STRING(50),
        allowNull: false,
        comment: 'The Item #/Product Id from the source file.',
    },
    
    // Dynamic Pricing and Quantity Details (Unique per invoice line)
    quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    unit_cost_at_sale: {
        type: DataTypes.DECIMAL(10, 2), // The exact price on the invoice (your "Item Cost")
        allowNull: false,
        comment: 'The Unit Cost at the time of sale (dynamic price).',
    },
    gst_rate: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        comment: 'The GST rate applied in this specific transaction.',
    },
    order_line_tax: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0.00,
    },
    
    // Static Item Name and HSN code fields are removed here 
    // because they will be retrieved via the Foreign Key link to the "products" table.

}, {
    tableName: 'order_items',
    timestamps: false, // Typically, transactional data doesn't need independent timestamps
});

module.exports = OrderItem;