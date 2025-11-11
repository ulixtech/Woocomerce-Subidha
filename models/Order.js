// models/Order.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Order = sequelize.define('Order', {
    bill_number: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
    },
    order_number: {
        type: DataTypes.STRING(50),
        allowNull: false,
    },
    order_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
    },
    cart_discount_amount: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0.00,
    },
    order_subtotal_amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
    },
    order_total_tax_amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
    },
    order_total_amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
    },
    payment_method: {
        type: DataTypes.STRING(50),
    },
    transaction_id: {
        type: DataTypes.STRING(255),
    },
}, {
    tableName: 'orders',
});

module.exports = Order;