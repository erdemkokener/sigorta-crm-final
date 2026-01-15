const fs = require('fs');
const path = require('path');
const db = require('../db');
const Customer = require('../models/Customer');
const Policy = require('../models/Policy');
const Settings = require('../models/Settings');
const User = require('../models/User');
const Payment = require('../models/Payment');

const dataFile = process.env.DATA_FILE || path.join(__dirname, '../data.json');

// Helper to read file data
function loadFile() {
  if (!fs.existsSync(dataFile)) {
    return { policies: [], nextId: 1, customers: [], nextCustomerId: 1, settings: {}, users: [], nextUserId: 1, payments: [], nextPaymentId: 1 };
  }
  const raw = fs.readFileSync(dataFile, 'utf8');
  const data = JSON.parse(raw);
  if (!data.customers) data.customers = [];
  if (!data.nextCustomerId) data.nextCustomerId = 1;
  if (!data.settings) data.settings = {};
  if (!data.users) data.users = [];
  if (!data.nextUserId) data.nextUserId = 1;
  if (!data.payments) data.payments = [];
  if (!data.nextPaymentId) data.nextPaymentId = 1;
  return data;
}

// Helper to save file data
function saveFile(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
  try {
    const baseDir = path.dirname(dataFile);
    const backupsDir = path.join(baseDir, 'backups');
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupsDir, `data-${stamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(data, null, 2));
  } catch (e) {
  }
}

const DataService = {
  async init() {
    await db.connectDB();
  },

  async getAllData() {
    if (db.isConnected()) {
      const [customers, policies, settingsDocs] = await Promise.all([
        Customer.find({}),
        Policy.find({}),
        Settings.find({})
      ]);

      // Convert settings array to object
      const settings = {};
      settingsDocs.forEach(s => {
        if (s.key === 'admin_config') {
          settings.admin_user = s.admin_user;
          settings.admin_pass = s.admin_pass;
        }
      });

      // Calculate nextIds
      const maxPolicyId = policies.reduce((max, p) => Math.max(max, p.id || 0), 0);
      const maxCustomerId = customers.reduce((max, c) => Math.max(max, c.id || 0), 0);

      return {
        policies: policies.map(p => p.toObject()),
        customers: customers.map(c => c.toObject()),
        settings,
        nextId: maxPolicyId + 1,
        nextCustomerId: maxCustomerId + 1
      };
    } else {
      return loadFile();
    }
  },

  async createCustomer(customerData) {
    if (db.isConnected()) {
      // Find next ID manually to ensure consistency
      const last = await Customer.findOne().sort({ id: -1 });
      const id = (last && last.id) ? last.id + 1 : 1;
      
      const customer = new Customer({ ...customerData, id });
      await customer.save();
      return customer.toObject();
    } else {
      const data = loadFile();
      const id = data.nextCustomerId++;
      const newCustomer = { ...customerData, id };
      data.customers.push(newCustomer);
      saveFile(data);
      return newCustomer;
    }
  },

  async updateCustomer(id, updateData) {
    if (db.isConnected()) {
      await Customer.findOneAndUpdate({ id }, updateData);
    } else {
      const data = loadFile();
      const idx = data.customers.findIndex(x => x.id === id);
      if (idx !== -1) {
        data.customers[idx] = { ...data.customers[idx], ...updateData };
        saveFile(data);
      }
    }
  },

  async deleteCustomer(id) {
    if (db.isConnected()) {
      await Customer.findOneAndDelete({ id });
    } else {
      const data = loadFile();
      data.customers = data.customers.filter(x => x.id !== id);
      saveFile(data);
    }
  },

  async createPolicy(policyData) {
    if (db.isConnected()) {
      const last = await Policy.findOne().sort({ id: -1 });
      const id = (last && last.id) ? last.id + 1 : 1;
      
      const policy = new Policy({ ...policyData, id });
      await policy.save();
      return policy.toObject();
    } else {
      const data = loadFile();
      const id = data.nextId++;
      const newPolicy = { ...policyData, id };
      data.policies.push(newPolicy);
      saveFile(data);
      return newPolicy;
    }
  },

  async updatePolicy(id, updateData) {
    if (db.isConnected()) {
      await Policy.findOneAndUpdate({ id }, updateData);
    } else {
      const data = loadFile();
      const idx = data.policies.findIndex(x => x.id === id);
      if (idx !== -1) {
        data.policies[idx] = { ...data.policies[idx], ...updateData };
        saveFile(data);
      }
    }
  },

  async deletePolicy(id) {
    if (db.isConnected()) {
      await Policy.findOneAndDelete({ id });
    } else {
      const data = loadFile();
      data.policies = data.policies.filter(x => x.id !== id);
      saveFile(data);
    }
  },

  async updateSettings(username, password) {
    if (db.isConnected()) {
      await Settings.findOneAndUpdate(
        { key: 'admin_config' },
        { key: 'admin_config', admin_user: username, admin_pass: password },
        { upsert: true }
      );
    } else {
      const data = loadFile();
      if (!data.settings) data.settings = {};
      data.settings.admin_user = username;
      data.settings.admin_pass = password;
      saveFile(data);
    }
  },

  async getUsers() {
    if (db.isConnected()) {
      const users = await User.find({});
      return users.map(u => u.toObject());
    } else {
      const data = loadFile();
      return data.users || [];
    }
  },

  async getUserByUsername(username) {
    if (db.isConnected()) {
      const user = await User.findOne({ username });
      return user ? user.toObject() : null;
    } else {
      const data = loadFile();
      const user = (data.users || []).find(u => u.username === username);
      return user || null;
    }
  },

  async createUser(userData) {
    if (db.isConnected()) {
      const user = new User(userData);
      await user.save();
      return user.toObject();
    } else {
      const data = loadFile();
      const id = data.nextUserId++;
      const newUser = { ...userData, id };
      data.users.push(newUser);
      saveFile(data);
      return newUser;
    }
  },

  async updateUser(id, updateData) {
    if (db.isConnected()) {
      await User.findByIdAndUpdate(id, updateData);
    } else {
      const data = loadFile();
      const idx = (data.users || []).findIndex(u => u.id === id);
      if (idx !== -1) {
        data.users[idx] = { ...data.users[idx], ...updateData };
        saveFile(data);
      }
    }
  },

  async deleteUser(id) {
    if (db.isConnected()) {
      await User.findByIdAndDelete(id);
    } else {
      const data = loadFile();
      data.users = (data.users || []).filter(u => u.id !== id);
      saveFile(data);
    }
  },

  async getPaymentsByCustomer(customerId) {
    if (db.isConnected()) {
      const payments = await Payment.find({ customer_id: customerId }).sort({ date: -1, id: -1 });
      return payments.map(p => p.toObject());
    } else {
      const data = loadFile();
      const list = (data.payments || []).filter(p => p.customer_id === customerId);
      return list.sort((a, b) => {
        if (a.date && b.date && a.date !== b.date) return a.date < b.date ? 1 : -1;
        return (b.id || 0) - (a.id || 0);
      });
    }
  },

  async createPayment(paymentData) {
    if (db.isConnected()) {
      const last = await Payment.findOne().sort({ id: -1 });
      const id = (last && last.id) ? last.id + 1 : 1;
      const payment = new Payment({ ...paymentData, id });
      await payment.save();
      return payment.toObject();
    } else {
      const data = loadFile();
      const id = data.nextPaymentId++;
      const newPayment = { ...paymentData, id };
      data.payments.push(newPayment);
      saveFile(data);
      return newPayment;
    }
  },
  
  async deletePayment(id) {
    if (db.isConnected()) {
      await Payment.findOneAndDelete({ id });
    } else {
      const data = loadFile();
      data.payments = (data.payments || []).filter(p => p.id !== id);
      saveFile(data);
    }
  },
  
  // Bulk import helper for Mongo
  async bulkCreatePolicies(policies, customers) {
    if (db.isConnected()) {
      // Logic for Mongo bulk import
      // This is complex because we need to handle customer deduplication and IDs
      // For simplicity, we will just loop. Efficiency is secondary here.
      
      for (const c of customers) {
        const exists = await Customer.findOne({ 
            $or: [ { id_no: c.id_no }, { name: new RegExp('^'+c.name+'$', "i") } ] 
        });
        
        let customerId;
        if (exists) {
            // Update?
            customerId = exists.id;
        } else {
            const created = await this.createCustomer(c);
            customerId = created.id;
        }
        
        // Find policies for this customer in the import list?
        // Actually the caller logic (server.js) handles matching.
        // We should just expose simple create methods and let server.js logic run?
        // But server.js logic relies on synchronous in-memory 'data' object.
        // It's better if server.js logic remains "Fetch all, process, save each".
      }
    }
    // Note: server.js handles the logic of parsing Excel and preparing objects.
    // We just need to ensure server.js calls createCustomer/createPolicy correctly.
  },

  async resetData() {
    if (db.isConnected()) {
      await Customer.deleteMany({});
      await Policy.deleteMany({});
      // We don't delete settings to not lock out admin
    } else {
      saveFile({ policies: [], nextId: 1, customers: [], nextCustomerId: 1, settings: {} });
    }
  }
};

module.exports = DataService;
