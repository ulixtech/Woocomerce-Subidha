const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Customer = sequelize.define('Customer', {
    // New Fields from the source file
    customer_user_id: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: 'Customer User ID/Account ID from source.',
    },
    customer_username: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'Customer Username/Login name.',
    },
    
    // Core Identification Fields for Lookup/Deduplication
    email: {
        type: DataTypes.STRING(255),
        allowNull: false, // Making email NOT NULL for reliable deduplication
        unique: true, // Guarantees one profile per email for primary lookup
        comment: 'Primary email used for lookup and profile uniqueness.',
    },
    
    // Merged Contact Details (JSON or TEXT is better for merging history)
    all_emails: {
        type: DataTypes.JSON, 
        allowNull: false,
        defaultValue: [],
        comment: 'JSON array of all unique email addresses associated with this profile.',
    },
    all_phones: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
        comment: 'JSON array of all unique phone numbers associated with this profile.',
    },

    // Current Contact/Billing Details (Updated to the latest on import)
    party_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
    },
    company_billing: {
        type: DataTypes.STRING(255),
        allowNull: false,
    },
    gst_number: {
        type: DataTypes.STRING(15),
        // Removed UNIQUE constraint here, as multiple profiles might exist if email is the primary deduplication key, 
        // or a single profile might not have a GST. GST is better tracked for lookup/merging.
        allowNull: true,
    },
    state_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
    },
    address: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'Last known billing address.',
    },
    pincode: {
        type: DataTypes.STRING(10),
        allowNull: false,
    },
    country: {
        type: DataTypes.STRING(100),
        allowNull: false,
    },
    // The single 'phone' field from the original schema is removed, 
    // as its value is now stored and merged into `all_phones`.
}, {
    tableName: 'customers',
    comment: 'Master table for unique customer profiles.',
});

module.exports = Customer;