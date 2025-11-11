const Customer = require('./Customer');
const Order = require('./Order');
const OrderItem = require('./OrderItem');
const Product = require('./Product'); // <-- NEW: Import the Product Master Model

// --- 1. Customer <--> Order (One-to-Many) ---
// An Order belongs to ONE Customer
Order.belongsTo(Customer, { 
    foreignKey: 'customerId', 
    allowNull: false // An order must belong to a customer
}); 
// A Customer has MANY Orders
Customer.hasMany(Order, { 
    foreignKey: 'customerId' 
});

// --- 2. Order <--> OrderItem (One-to-Many) ---
// An OrderItem belongs to ONE Order
OrderItem.belongsTo(Order, { 
    foreignKey: 'orderId', 
    allowNull: false // An item must belong to an order
});
// An Order has MANY OrderItems
Order.hasMany(OrderItem, { 
    foreignKey: 'orderId' 
});

// --- 3. Product <--> OrderItem (One-to-Many) ---
// NEW RELATIONSHIP: An OrderItem belongs to ONE Product (the master item)
OrderItem.belongsTo(Product, { 
    foreignKey: 'productId', // Foreign key column name in order_items table
    allowNull: false // An order item must be linked to a master product
});
// A Product (master) can be in MANY OrderItems
Product.hasMany(OrderItem, { 
    foreignKey: 'productId' 
});


module.exports = {
    Customer,
    Order,
    OrderItem,
    Product, // <-- NEW: Export the Product Model
};