const path = require('path');
const fs = require('fs');
const express = require('express');
const morgan = require('morgan');
const dayjs = require('dayjs');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const ExcelJS = require('exceljs');
const db = require('./db');
const dataService = require('./services/dataService');

let multer, upload;
try {
  multer = require('multer');
  upload = multer({ dest: 'uploads/' });
} catch (e) {
  console.log('Multer modülü bulunamadı. Dosya yükleme çalışmayacak.');
}

const app = express();
const PORT = process.env.PORT || 3000;

const USER = process.env.APP_USER || 'admin';
const PASS = process.env.APP_PASS || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this';

// Mailer Config
const MAIL_MODE = process.env.MAIL_MODE || 'console';
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const MAIL_FROM = process.env.MAIL_FROM || 'no-reply@example.com';
const MAIL_TO = process.env.MAIL_TO || '';

let mailer = null;
function initMailer() {
  const nodemailer = require('nodemailer');
  if (MAIL_MODE === 'console') {
    mailer = nodemailer.createTransport({ jsonTransport: true });
    return;
  }
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    mailer = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
  }
}

// Initialize DB and Mailer
async function init() {
  await dataService.init();
  initMailer();
}
init();

// Helper to get everything needed for a request (backward compatibility)
async function getContext() {
  return await dataService.getAllData();
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(morgan('dev'));
app.use(expressLayouts);
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function policyWithComputed(p) {
  const today = dayjs();
  const end = dayjs(p.end_date);
  const start = dayjs(p.start_date);
  return {
    ...p,
    days_remaining: end.diff(today, 'day'),
    days_total: end.diff(start, 'day'),
    is_expiring_soon: end.diff(today, 'day') <= 30,
    is_expired: end.isBefore(today, 'day')
  };
}

function attachCustomer(p, data) {
  const c = data.customers.find(x => x.id == p.customer_id);
  return {
    ...p,
    customer_name: c ? c.name : '',
    customer_phone: c ? c.phone : '',
    customer_id_no: c ? c.id_no : '',
    customer_email: c ? c.email : '',
    customer_birth_date: c ? c.birth_date : ''
  };
}

async function filterPolicies(query) {
  const data = await getContext();
  let items = data.policies.map(p => attachCustomer(p, data));

  const q = (query.q || '').toLocaleLowerCase('tr-TR');
  const insurer = (query.insurer || '').toLocaleLowerCase('tr-TR');
  const status = (query.status || '').toLocaleLowerCase('tr-TR');
  const endFrom = query.end_from ? dayjs(query.end_from) : null;
  const endTo = query.end_to ? dayjs(query.end_to) : null;
  
  if (q) {
    items = items.filter(x =>
      String(x.customer_name || '').toLocaleLowerCase('tr-TR').includes(q) ||
      String(x.policy_number || '').toLocaleLowerCase('tr-TR').includes(q) ||
      String(x.customer_phone || '').toLocaleLowerCase('tr-TR').includes(q) ||
      String(x.customer_id_no || '').toLocaleLowerCase('tr-TR').includes(q)
    );
  }
  if (insurer) {
    items = items.filter(x => (x.insurer || '').toLocaleLowerCase('tr-TR').includes(insurer));
  }
  if (status) {
    items = items.filter(x => (x.status || '').toLocaleLowerCase('tr-TR') === status);
  }
  if (endFrom) {
    items = items.filter(x => dayjs(x.end_date).isSame(endFrom) || dayjs(x.end_date).isAfter(endFrom));
  }
  if (endTo) {
    items = items.filter(x => dayjs(x.end_date).isSame(endTo) || dayjs(x.end_date).isBefore(endTo));
  }
  items = items.sort((a, b) => a.end_date.localeCompare(b.end_date) || b.id - a.id);
  return items;
}

async function sendMail(subject, text, html) {
  if (!mailer) {
    console.log('Mailer kurulu değil, e-posta atlanıyor.');
    return;
  }
  const to = MAIL_TO || (process.env.APP_USER_EMAIL || '');
  const envelope = { from: MAIL_FROM, to: to || MAIL_FROM, subject, text, html };
  try {
    const info = await mailer.sendMail(envelope);
    console.log('E-posta gönderildi:', info.messageId);
  } catch (err) {
    console.error('E-posta hatası:', err);
  }
}

async function checkExpirationsAndNotify(force = false) {
  console.log('Poliçe süreleri kontrol ediliyor...');
  const data = await getContext();
  const today = dayjs().startOf('day');
  let sentCount = 0;

  for (const p of data.policies) {
    const end = dayjs(p.end_date).startOf('day');
    const days = end.diff(today, 'day');
    
    if ((days === 14 && !p.notified_14) || (force && days === 14)) {
      await sendMail(
        'Poliçe bitimine 14 gün kaldı',
        `Poliçe ${p.policy_number} (${p.customer_name}) ${p.end_date} tarihinde bitecek.\nTelefon: ${p.customer_phone || '-'}`,
        `<p>Poliçe <b>${p.policy_number}</b> (${p.customer_name}) <b>${p.end_date}</b> tarihinde bitecek.</p><p>Telefon: <b>${p.customer_phone || '-'}</b></p>`
      );
      await dataService.updatePolicy(p.id, { notified_14: true });
      sentCount++;
    }
    if ((days === 0 && !p.notified_end) || (force && days === 0)) {
      await sendMail(
        'Poliçe bugün bitiyor',
        `Poliçe ${p.policy_number} (${p.customer_name}) bugün (${p.end_date}) bitiyor.\nTelefon: ${p.customer_phone || '-'}`,
        `<p>Poliçe <b>${p.policy_number}</b> (${p.customer_name}) bugün (<b>${p.end_date}</b>) bitiyor.</p><p>Telefon: <b>${p.customer_phone || '-'}</b></p>`
      );
      await dataService.updatePolicy(p.id, { notified_end: true });
      sentCount++;
    }
  }
  console.log(`Kontrol tamamlandı. ${sentCount} bildirim gönderildi.`);
  return sentCount;
}

// Check every hour
setInterval(checkExpirationsAndNotify, 60 * 60 * 1000);
checkExpirationsAndNotify();

// Routes
app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.redirect('/policies');
});

app.get('/login', (req, res) => {
  res.render('auth/login', { title: 'Giriş' });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const data = await getContext();
  const validUser = data.settings?.admin_user || USER;
  const validPass = data.settings?.admin_pass || PASS;

  if (username === validUser && password === validPass) {
    req.session.user = { username };
    return res.redirect('/policies');
  }
  res.status(401).render('auth/login', { title: 'Giriş', error: 'Kullanıcı adı veya şifre hatalı' });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/settings', requireAuth, (req, res) => {
  res.render('settings', { title: 'Ayarlar', msg: req.query.msg, error: req.query.error });
});

app.post('/settings', requireAuth, async (req, res) => {
  const { old_password, new_username, new_password } = req.body;
  const data = await getContext();
  const currentPass = data.settings?.admin_pass || PASS;

  if (old_password !== currentPass) {
    return res.redirect('/settings?error=' + encodeURIComponent('Mevcut şifre hatalı.'));
  }

  await dataService.updateSettings(new_username, new_password);
  req.session.user.username = new_username;
  res.redirect('/settings?msg=' + encodeURIComponent('Bilgiler başarıyla güncellendi.'));
});

app.get('/customers', requireAuth, async (req, res) => {
  const data = await getContext();
  const q = (req.query.q || '').toLocaleLowerCase('tr-TR');
  let customers = data.customers.slice();
  if (q) {
    customers = customers.filter(c =>
      (c.name || '').toLocaleLowerCase('tr-TR').includes(q) ||
      (c.phone || '').toLocaleLowerCase('tr-TR').includes(q) ||
      (c.id_no || '').toLocaleLowerCase('tr-TR').includes(q) ||
      (c.email || '').toLocaleLowerCase('tr-TR').includes(q)
    );
  }
  res.render('customers/index', { title: 'Müşteriler', customers, q });
});

app.get('/customers/new', requireAuth, (req, res) => {
  res.render('customers/new', { title: 'Yeni Müşteri' });
});

app.post('/customers', requireAuth, async (req, res) => {
  const { name, phone, id_no, email, birth_date } = req.body;
  if (!name) return res.status(400).send('Müşteri adı zorunlu');
  
  await dataService.createCustomer({
    name,
    phone: phone || '',
    id_no: id_no || '',
    email: email || '',
    birth_date: birth_date || ''
  });
  res.redirect('/customers');
});

app.get('/customers/:id/edit', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const data = await getContext();
  const c = data.customers.find(x => x.id === id);
  if (!c) return res.status(404).send('Müşteri bulunamadı');
  res.render('customers/edit', { title: 'Müşteri Düzenle', customer: c });
});

app.post('/customers/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  await dataService.updateCustomer(id, {
    name: req.body.name,
    phone: req.body.phone,
    id_no: req.body.id_no,
    email: req.body.email,
    birth_date: req.body.birth_date
  });
  res.redirect('/customers');
});

app.post('/customers/:id/delete', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const data = await getContext();
  const anyPolicy = data.policies.some(p => p.customer_id === id);
  if (anyPolicy) {
    return res.status(400).send('Bu müşteriye bağlı poliçe mevcut; silmeden önce poliçeleri kaldırın.');
  }
  await dataService.deleteCustomer(id);
  res.redirect('/customers');
});

app.get('/customers/export.xlsx', requireAuth, async (req, res) => {
  const data = await getContext();
  const customers = data.customers;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Müşteriler');
  ws.columns = [
    { header: 'Adı Soyadı', key: 'name', width: 25 },
    { header: 'Telefon', key: 'phone', width: 16 },
    { header: 'Kimlik No', key: 'id_no', width: 16 },
    { header: 'E-posta', key: 'email', width: 25 },
    { header: 'Doğum Tarihi', key: 'birth_date', width: 14 }
  ];
  for (const c of customers) {
    ws.addRow({
      name: c.name,
      phone: c.phone,
      id_no: c.id_no,
      email: c.email,
      birth_date: c.birth_date
    });
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=\"musteriler.xlsx\"');
  await wb.xlsx.write(res);
  res.end();
});

app.get('/policies', requireAuth, async (req, res) => {
  const data = await getContext();
  const items = (await filterPolicies(req.query)).map(p => policyWithComputed(p));
  const qs = new URLSearchParams(req.query).toString();
  const totalPolicies = data.policies.length;
  const totalCustomers = data.customers.length;
  res.render('policies/index', { policies: items, title: 'Poliçeler', qs, totalPolicies, totalCustomers });
});

app.get('/policies/import', requireAuth, (req, res) => {
  if (!upload) return res.send('Dosya yükleme özelliği için "multer" modülü gerekli. Lütfen "npm install multer" komutunu çalıştırın.');
  res.render('policies/import', { title: 'Excel İçe Aktar' });
});

app.post('/policies/import', requireAuth, (req, res, next) => {
  if (!upload) return res.status(500).send('Multer modülü eksik.');
  upload.single('file')(req, res, next);
}, async (req, res) => {
  if (!req.file) return res.status(400).send('Dosya yüklenmedi');

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.readFile(req.file.path);
    const ws = wb.getWorksheet(1);
    const data = await getContext();
    let importedCount = 0;

    const rowsToProcess = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      rowsToProcess.push(row);
    });

    for (const row of rowsToProcess) {
      const customerName = row.getCell(1).text;
      const phone = row.getCell(2).text;
      const idNo = row.getCell(3).text;
      const birthDate = row.getCell(4).text;
      const insurer = row.getCell(5).text;
      const policyType = row.getCell(6).text;
      const policyNumber = row.getCell(7).text;
      const startDate = row.getCell(8).text;
      const endDate = row.getCell(9).text;
      const description = row.getCell(11).text;
      const status = row.getCell(12).text;

      if (!customerName || !policyNumber) continue;

      let customer = data.customers.find(c => 
        (c.id_no && c.id_no === idNo) || (c.name.toLowerCase() === customerName.toLowerCase())
      );

      if (!customer) {
        customer = await dataService.createCustomer({
          name: customerName,
          phone: phone || '',
          id_no: idNo || '',
          email: '',
          birth_date: birthDate || ''
        });
        data.customers.push(customer);
      }

      const existingPolicy = data.policies.find(p => p.policy_number === policyNumber && p.insurer === insurer);
      if (!existingPolicy) {
        const newPolicy = await dataService.createPolicy({
          customer_id: customer.id,
          insurer: insurer || 'Diğer',
          policy_type: policyType || 'Diğer',
          policy_number: policyNumber,
          issue_date: '',
          start_date: startDate || '',
          end_date: endDate || '',
          description: description || '',
          status: status || 'active',
          created_at: dayjs().toISOString(),
          notified_14: false,
          notified_end: false
        });
        data.policies.push(newPolicy);
        importedCount++;
      }
    }

    fs.unlinkSync(req.file.path);
    res.redirect('/policies?msg=' + encodeURIComponent(`${importedCount} adet poliçe başarıyla eklendi.`));
  } catch (err) {
    console.error(err);
    res.status(500).send('Dosya işlenirken hata oluştu: ' + err.message);
  }
});

app.get('/policies/new', requireAuth, async (req, res) => {
  const data = await getContext();
  res.render('policies/new', { title: 'Yeni Poliçe', customers: data.customers });
});

app.post('/policies', requireAuth, async (req, res) => {
  const { customer_id, insurer, policy_number, start_date, end_date, description, status, issue_date, policy_type } = req.body;
  if (!customer_id || !insurer || !policy_number || !start_date || !end_date) {
    return res.status(400).send('Eksik alanlar mevcut');
  }
  const created_at = dayjs().toISOString();
  await dataService.createPolicy({
    customer_id: Number(customer_id),
    insurer,
    policy_number,
    issue_date: issue_date || '',
    start_date,
    end_date,
    description: description || '',
    policy_type: policy_type || 'Diğer',
    status: status || 'active',
    created_at,
    notified_14: false,
    notified_end: false
  });
  res.redirect('/policies');
});

app.get('/policies/template.xlsx', requireAuth, async (req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sablon');
  ws.columns = [
    { header: 'Müşteri Adı', key: 'name', width: 25 },
    { header: 'Telefon', key: 'phone', width: 15 },
    { header: 'TC/Vergi No', key: 'id_no', width: 15 },
    { header: 'Doğum Tarihi', key: 'birth_date', width: 15 },
    { header: 'Sigorta Şirketi', key: 'insurer', width: 20 },
    { header: 'Poliçe Türü', key: 'policy_type', width: 15 },
    { header: 'Poliçe No', key: 'policy_number', width: 20 },
    { header: 'Başlangıç Tarihi', key: 'start_date', width: 15 },
    { header: 'Bitiş Tarihi', key: 'end_date', width: 15 },
    { header: 'Açıklama', key: 'description', width: 30 },
    { header: 'Durum (Aktif/İptal)', key: 'status', width: 15 }
  ];
  ws.addRow({
    name: 'Örnek Müşteri',
    phone: '5551234567',
    id_no: '11111111111',
    birth_date: '01.01.1980',
    insurer: 'A Sigorta',
    policy_type: 'Trafik',
    policy_number: '12345678',
    start_date: '01.01.2026',
    end_date: '01.01.2027',
    description: 'Plaka: 34ABC123',
    status: 'Aktif'
  });
  
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=\"sablon.xlsx\"');
  await wb.xlsx.write(res);
  res.end();
});

app.get('/policies/:id/edit', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const data = await getContext();
  const p = data.policies.find(x => x.id === id);
  if (!p) return res.status(404).send('Poliçe bulunamadı');
  res.render('policies/edit', { title: 'Poliçe Düzenle', policy: p, customers: data.customers });
});

app.post('/policies/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { customer_id, insurer, policy_number, start_date, end_date, description, status, issue_date, policy_type } = req.body;
  await dataService.updatePolicy(id, {
    customer_id: Number(customer_id),
    insurer,
    policy_number,
    issue_date: issue_date || '',
    start_date,
    end_date,
    description: description || '',
    policy_type: policy_type || 'Diğer',
    status: status || 'active'
  });
  res.redirect('/policies/' + id);
});

app.post('/policies/:id/delete', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  await dataService.deletePolicy(id);
  res.redirect('/policies');
});

app.post('/policies/delete-cancelled', requireAuth, async (req, res) => {
  const data = await getContext();
  const cancelled = data.policies.filter(p => {
    const s = (p.status || '').toLowerCase().trim();
    return s === 'cancelled' || s === 'iptal';
  });
  
  for (const p of cancelled) {
    await dataService.deletePolicy(p.id);
  }
  
  res.redirect('/policies?msg=' + encodeURIComponent(`${cancelled.length} adet iptal edilmiş poliçe silindi.`));
});

app.post('/policies/reset-data', requireAuth, async (req, res) => {
  await dataService.resetData();
  res.redirect('/policies?msg=' + encodeURIComponent('Tüm veriler başarıyla sıfırlandı.'));
});

app.post('/api/trigger-notifications', async (req, res) => {
  const sent = await checkExpirationsAndNotify(true);
  res.redirect('/policies?msg=' + encodeURIComponent(`${sent} adet bildirim gönderildi.`));
});

app.get('/api/policies', requireAuth, async (req, res) => {
  const items = (await filterPolicies(req.query)).map(p => policyWithComputed(p));
  res.json(items);
});

app.get('/policies/export.xlsx', requireAuth, async (req, res) => {
  const items = await filterPolicies(req.query);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Poliçeler');
  ws.columns = [
    { header: 'Müşteri', key: 'customer_name', width: 25 },
    { header: 'Sigorta Şirketi', key: 'insurer', width: 20 },
    { header: 'Poliçe Türü', key: 'policy_type', width: 15 },
    { header: 'Poliçe No', key: 'policy_number', width: 20 },
    { header: 'Başlangıç', key: 'start_date', width: 15 },
    { header: 'Bitiş', key: 'end_date', width: 15 },
    { header: 'Kalan Gün', key: 'days_left', width: 10 },
    { header: 'Durum', key: 'status', width: 15 }
  ];
  
  for (const p of items) {
    const comp = policyWithComputed(p);
    ws.addRow({
      customer_name: comp.customer_name,
      insurer: comp.insurer,
      policy_type: comp.policy_type,
      policy_number: comp.policy_number,
      start_date: comp.start_date,
      end_date: comp.end_date,
      days_left: comp.days_remaining,
      status: comp.status === 'active' ? 'Aktif' : (comp.status === 'cancelled' ? 'İptal' : comp.status)
    });
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=\"policeler.xlsx\"');
  await wb.xlsx.write(res);
  res.end();
});

app.get('/policies/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const data = await getContext();
  const p = data.policies.find(x => x.id === id);
  if (!p) return res.status(404).send('Poliçe bulunamadı');
  const policy = policyWithComputed(attachCustomer(p, data));
  const qs = new URLSearchParams(req.query).toString();
  res.render('policies/show', { title: 'Poliçe Detay', policy, qs });
});

app.use((req, res) => {
  res.status(404).send('Sayfa bulunamadı');
});

app.listen(PORT, () => {
  console.log(`Sigorta CRM sunucu çalışıyor: http://localhost:${PORT}`);
});
