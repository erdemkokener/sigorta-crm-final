const path = require('path');
const fs = require('fs');
// Sigorta CRM Sunucusu
const express = require('express');
const morgan = require('morgan');
const dayjs = require('dayjs');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const ExcelJS = require('exceljs');
const bcrypt = require('bcryptjs');
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
const PORT = process.env.PORT || 3001;

const USER = process.env.APP_USER || 'admin';
const PASS = process.env.APP_PASS || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this';

// Mailer Config
const MAIL_MODE = process.env.MAIL_MODE || 'console';
// Remove const MAIL_FROM, use dynamic
let currentMailFrom = process.env.MAIL_FROM || 'no-reply@example.com'; 
let globalMailTo = process.env.MAIL_TO || '';
let globalAppUrl = process.env.APP_URL || '';
const EMERGENCY_RESET_CODE = process.env.EMERGENCY_RESET_CODE || '';

let mailer = null;
let lastSmtpError = null;

async function initMailer() {
  const nodemailer = require('nodemailer');
  lastSmtpError = null;
  
  // Fetch settings from DB
  let settings = {};
  try {
      const data = await getContext();
      settings = data.settings || {};
  } catch (err) {
      console.error('initMailer: Data fetch error', err);
  }

  // 1. DB Settings
  const dbHost = settings.smtp_host;
  const dbPort = settings.smtp_port;
  const dbUser = settings.smtp_user;
  const dbPass = settings.smtp_pass;
  const dbSecure = settings.smtp_secure; // boolean
  const dbFrom = settings.smtp_from;
  const dbAppUrl = settings.app_url;
  
  // Update Global Notification Email
  if (settings.notification_email) {
      globalMailTo = settings.notification_email;
  } else {
      globalMailTo = process.env.MAIL_TO || '';
  }
  
  // Update Global App URL
  // Render.com automatically sets RENDER_EXTERNAL_URL
  globalAppUrl = dbAppUrl || process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || '';

  // Use configured "From" -> "User Email" -> "Env From" -> Default
  if (dbFrom) {
      currentMailFrom = dbFrom;
  } else if (dbUser) {
      currentMailFrom = dbUser;
  }

  // 2. Env Vars Fallback
  let finalHost = dbHost || process.env.SMTP_HOST;
  let finalPort = dbPort || Number(process.env.SMTP_PORT || 587);
  let finalUser = dbUser || process.env.SMTP_USER;
  let finalPass = dbPass || process.env.SMTP_PASS;
  let finalSecure = (dbSecure !== undefined) ? dbSecure : (process.env.SMTP_SECURE === 'true');
  
  // Force Gmail settings for better compatibility on Render/Cloud
  // if (finalHost === 'smtp.gmail.com') { ... } block removed for simplicity and reliability with other providers
  
  if (finalHost === 'smtp.gmail.com') {
      console.log('Mailer: Gmail tespit edildi, standart optimizasyonlar uygulanıyor (IPv4)...');
  }

  if (MAIL_MODE === 'console' && !finalHost) {
    console.log('Mailer: Console modu (SMTP ayarı yok).');
    mailer = nodemailer.createTransport({ jsonTransport: true });
    return;
  }

  // Set name for HELO/EHLO using globalAppUrl if available
  const transportConfig = {
      host: finalHost,
      port: finalPort,
      secure: finalSecure,
      auth: { user: finalUser, pass: finalPass },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 60000, // Increased to 60s
      greetingTimeout: 30000,   // Increased to 30s
      socketTimeout: 60000,     // Increased to 60s
      family: 4 // Force IPv4 to prevent IPv6 timeouts on cloud providers
  };
  
  if (globalAppUrl) {
      try {
          const hostname = new URL(globalAppUrl).hostname;
          if (hostname && hostname !== 'localhost') {
              transportConfig.name = hostname;
          }
      } catch (e) { /* ignore invalid url */ }
  }

  if (finalHost && finalUser && finalPass) {
    console.log(`Mailer: SMTP yapılandırılıyor (${finalHost}:${finalPort})...`);
    if (finalPort === 587) transportConfig.connectionTimeout = 10000;
    mailer = nodemailer.createTransport(transportConfig);
    
    try {
        await mailer.verify();
        console.log('Mailer: SMTP bağlantısı başarılı.');
    } catch (err) {
        console.error('Mailer: SMTP bağlantı hatası:', err.message);
        const code = err && err.code ? err.code : '';
        const msg = err && err.message ? err.message.toLowerCase() : '';
        const timeoutLike = code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ESOCKET' || code === 'ENOTFOUND' || msg.includes('timeout') || msg.includes('timed out') || msg.includes('refused') || msg.includes('socket') || msg.includes('not found');
        if (finalHost === 'smtp.gmail.com' && timeoutLike) {
             const retryConfig = { ...transportConfig, port: 465, secure: true, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 25000, family: 4 };
             const retryMailer = nodemailer.createTransport(retryConfig);
             try {
                 await retryMailer.verify();
                 mailer = retryMailer;
                 lastSmtpError = null;
                 return;
             } catch (retryErr) {
                 lastSmtpError = retryErr.message;
             }
        } else {
            lastSmtpError = err.message;
        }
        mailer = null; 
    }
  } else {
    if (finalHost || finalUser) {
        console.log('Mailer: SMTP bilgileri eksik.');
        lastSmtpError = 'Eksik SMTP ayarları (Host, Kullanıcı ve Şifre zorunlu).';
    } else {
        console.log('Mailer: SMTP yapılandırılmamış.');
    }
    mailer = null;
  }
}

// Initialize DB and Mailer
async function init() {
  await dataService.init();
  await initMailer();
}

// Start Server
init().then(() => {
  app.listen(PORT, () => {
    console.log(`Sigorta CRM sunucu çalışıyor: http://localhost:${PORT}`);
  });
});
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
  res.locals.fileMode = !db.isConnected();
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || !req.session.user.isAdmin) {
    return res.status(403).send('Bu işlem için yetkiniz yok');
  }
  next();
}

function policyWithComputed(p) {
  const today = dayjs();
  const end = dayjs(p.end_date);
  const start = dayjs(p.start_date);
  const totalPremium = Number(p.premium || 0);
  const paidPremium = Number(p.premium_paid || 0);
  const remainingPremium = totalPremium - paidPremium;
  return {
    ...p,
    days_remaining: end.diff(today, 'day'),
    days_total: end.diff(start, 'day'),
    is_expiring_soon: end.diff(today, 'day') <= 30,
    is_expired: end.isBefore(today, 'day'),
    premium_total: totalPremium,
    premium_paid: paidPremium,
    premium_remaining: remainingPremium
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
  let allPolicies = data.policies.map(p => attachCustomer(p, data));
  let items = [...allPolicies];

  const q = (query.q || '').toLocaleLowerCase('tr-TR');
  const insurer = (query.insurer || '').toLocaleLowerCase('tr-TR');
  const status = (query.status || '').toLocaleLowerCase('tr-TR');
  const includeMissed = query.include_missed === 'true';
  const excludeShortTerm = query.exclude_short_term === 'true';

  // 1. General Filters (Search, Insurer)
  if (q) {
    items = items.filter(x =>
      String(x.customer_name || '').toLocaleLowerCase('tr-TR').includes(q) ||
      String(x.policy_number || '').toLocaleLowerCase('tr-TR').includes(q) ||
      String(x.customer_phone || '').toLocaleLowerCase('tr-TR').includes(q) ||
      String(x.customer_id_no || '').toLocaleLowerCase('tr-TR').includes(q) ||
      String(x.description || '').toLocaleLowerCase('tr-TR').includes(q) ||
      (x.policy_details && x.policy_details.plate && String(x.policy_details.plate).toLocaleLowerCase('tr-TR').includes(q))
    );
  }
  if (insurer) {
    items = items.filter(x => (x.insurer || '').toLocaleLowerCase('tr-TR').includes(insurer));
  }

  // 2. Date Filtering Setup
  const filter = query.filter; // today, tomorrow, week
  let rangeStart = null;
  let rangeEnd = null;
  const today = dayjs();

  if (filter === 'today') {
     rangeStart = today.startOf('day');
     rangeEnd = today.endOf('day');
  } else if (filter === 'tomorrow') {
     rangeStart = today.add(1, 'day').startOf('day');
     rangeEnd = today.add(1, 'day').endOf('day');
  } else if (filter === 'week') {
     rangeStart = today.startOf('day');
     rangeEnd = today.endOf('week').add(1, 'day'); 
  } else {
     if (query.end_from) rangeStart = dayjs(query.end_from).startOf('day');
     if (query.end_to) rangeEnd = dayjs(query.end_to).endOf('day');
  }

  let finalItems = [];

  // A. Standard Matches
  const standardMatches = items.filter(x => {
      // Short Term Check (Duration < 100 days)
      if (excludeShortTerm) {
        const start = dayjs(x.start_date);
        const end = dayjs(x.end_date);
        if (end.diff(start, 'day') < 100) return false;
      }

      // Status Check (Only apply strict status filter to standard matches)
      if (status && (x.status || '').toLocaleLowerCase('tr-TR') !== status) return false;
      
      // Date Check
      if (rangeStart && dayjs(x.end_date).isBefore(rangeStart)) return false;
      if (rangeEnd && dayjs(x.end_date).isAfter(rangeEnd)) return false;
      
      // Issue Date Checks
      if (query.issue_from && dayjs(x.issue_date || x.start_date).isBefore(dayjs(query.issue_from))) return false;
      if (query.issue_to && dayjs(x.issue_date || x.start_date).isAfter(dayjs(query.issue_to))) return false;

      return true;
  });
  
  finalItems = [...standardMatches];

  // B. Missed Matches (Potential Renewals)
  if (includeMissed && rangeStart && rangeEnd) {
      const missedMatches = items.filter(p => {
          const pEnd = dayjs(p.end_date);
          
          // Must be older than the range's start year
          if (pEnd.year() >= rangeStart.year()) return false;
          
          // Project the date to the target year (match Month/Day)
          const targetYear = rangeStart.year();
          const virtualDate = pEnd.year(targetYear);
          
          // Check if virtual date is in range
          if (virtualDate.isBefore(rangeStart) || virtualDate.isAfter(rangeEnd)) return false;
          
          // Check for Successor (Is there a newer policy?)
          const hasSuccessor = allPolicies.some(other => {
              if (other.id === p.id) return false;
              
              // 1. Plate Match
              const pPlate = p.policy_details?.plate?.replace(/\s/g, '').toUpperCase();
              const oPlate = other.policy_details?.plate?.replace(/\s/g, '').toUpperCase();
              
              if (pPlate && pPlate.length > 3 && oPlate === pPlate) {
                  // If other policy starts after this one ends (with generous buffer)
                  if (dayjs(other.start_date).isAfter(dayjs(p.end_date).subtract(60, 'day'))) return true;
              }
              
              // 2. Customer + Type Match
              if (other.customer_id === p.customer_id && other.policy_type === p.policy_type) {
                   if (dayjs(other.start_date).isAfter(dayjs(p.end_date).subtract(60, 'day'))) return true;
              }
              
              return false;
          });
          
          if (hasSuccessor) return false;
          
          return true;
      });
      
      // Mark them
      const markedMissed = missedMatches.map(p => ({ ...p, is_missed_renewal: true }));
      finalItems = [...finalItems, ...markedMissed];
  }

  // Sort
  if (includeMissed) {
      // Sort by Virtual Date (Day/Month) to interleave
      finalItems.sort((a, b) => {
          const da = dayjs(a.end_date).year(2000); 
          const db = dayjs(b.end_date).year(2000);
          return da.diff(db);
      });
  } else {
      finalItems.sort((a, b) => a.end_date.localeCompare(b.end_date) || b.id - a.id);
  }

  return finalItems;
}

async function sendMail(subject, text, html, attachments = [], targetEmail = null) {
  // Lazy init attempt if mailer is null
  if (!mailer) {
      console.log('Mailer kurulu değil, yeniden başlatılıyor...');
      await initMailer();
  }

  if (!mailer) {
    console.log('Mailer kurulu değil, e-posta atlanıyor.');
    return { ok: false, error: 'Mailer yapılandırılmamış veya bağlantı hatası' + (lastSmtpError ? ': ' + lastSmtpError : '') };
  }
  // Try to determine 'to' address if not provided. 
  // If targetEmail is null, we usually want to send TO the admin (APP_USER_EMAIL or the sender themselves if testing)
  // For notifications to the owner, we use globalMailTo or fallback
  const to = targetEmail || globalMailTo || process.env.APP_USER_EMAIL || currentMailFrom;
  
  // Append App URL to HTML if available
  if (globalAppUrl && html) {
      html += `<br><hr><p><a href="${globalAppUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Sisteme Git</a></p>`;
  }

  const envelope = { from: currentMailFrom, to, subject, text, html, attachments };
  try {
    const info = await mailer.sendMail(envelope);
    console.log(`E-posta gönderildi. ID: ${info.messageId}, TO: ${to}`);
    return { ok: true, info, to };
  } catch (err) {
    console.error('E-posta hatası:', err);
    const code = err && err.code ? err.code : '';
    const msg = err && err.message ? err.message.toLowerCase() : '';
    const timeoutLike = code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ESOCKET' || code === 'ENOTFOUND' || msg.includes('timeout') || msg.includes('timed out') || msg.includes('refused') || msg.includes('socket') || msg.includes('not found');
    if (timeoutLike && currentMailFrom.includes('gmail.com')) {
         const nodemailer = require('nodemailer');
         let user = process.env.SMTP_USER || currentMailFrom;
         let pass = process.env.SMTP_PASS || '';
         try {
             const ctx = await getContext();
             user = ctx.settings?.smtp_user || user;
             pass = ctx.settings?.smtp_pass || pass;
         } catch (_) {}
         const retryConfig = {
             host: 'smtp.gmail.com',
             port: 465,
             secure: true,
             auth: { user, pass },
             connectionTimeout: 15000,
             greetingTimeout: 15000,
             socketTimeout: 25000,
             family: 4, // Force IPv4
             tls: { rejectUnauthorized: false }
         };
         if (retryConfig.auth.user && retryConfig.auth.pass) {
             try {
                 const emergencyMailer = nodemailer.createTransport(retryConfig);
                 const info = await emergencyMailer.sendMail(envelope);
                 mailer = emergencyMailer;
                 return { ok: true, info, to, note: 'Recovered via 465' };
             } catch (retryErr) {
                 return { ok: false, error: 'Tüm denemeler başarısız: ' + (retryErr.message || ''), to };
             }
         }
    }
    return { ok: false, error: err.message || 'E-posta gönderilemedi', to };
  }
}

async function checkAndRunMonthlyBackup() {
  const today = dayjs();
  // Run only on the 1st day of the month
  if (today.date() !== 1) return;

  const backupDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const monthStr = today.format('YYYY-MM');
  const backupFlagFile = path.join(backupDir, `backup-${monthStr}.done`);

  // Check if already done for this month
  if (fs.existsSync(backupFlagFile)) return;

  console.log('Aylık yedekleme başlatılıyor...');
  
  try {
    const data = await getContext();
    const customers = data.customers || [];
    const policies = data.policies || [];

    // 1. Generate Customers Excel
    const wbCustomers = new ExcelJS.Workbook();
    const wsCustomers = wbCustomers.addWorksheet('Müşteriler');
    wsCustomers.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Ad Soyad', key: 'name', width: 30 },
      { header: 'Telefon', key: 'phone', width: 15 },
      { header: 'TC/VKN', key: 'id_no', width: 15 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Adres', key: 'address', width: 30 }
    ];
    wsCustomers.addRows(customers);
    const customerFilePath = path.join(backupDir, `Musteriler-${monthStr}.xlsx`);
    await wbCustomers.xlsx.writeFile(customerFilePath);

    // 2. Generate Policies Excel
    const wbPolicies = new ExcelJS.Workbook();
    const wsPolicies = wbPolicies.addWorksheet('Poliçeler');
    wsPolicies.columns = [
      { header: 'Poliçe No', key: 'policy_number', width: 15 },
      { header: 'Müşteri', key: 'customer_name', width: 20 },
      { header: 'Şirket', key: 'insurer', width: 15 },
      { header: 'Tür', key: 'policy_type', width: 15 },
      { header: 'Başlangıç', key: 'start_date', width: 15 },
      { header: 'Bitiş', key: 'end_date', width: 15 },
      { header: 'Prim', key: 'premium', width: 10 },
      { header: 'Durum', key: 'status', width: 10 }
    ];
    
    // Attach customer names
    const policiesWithNames = policies.map(p => attachCustomer(p, data));
    wsPolicies.addRows(policiesWithNames);
    const policyFilePath = path.join(backupDir, `Policeler-${monthStr}.xlsx`);
    await wbPolicies.xlsx.writeFile(policyFilePath);

    // 3. Send Email
    await sendMail(
      `Otomatik Yedek - ${monthStr}`,
      `Ekte ${monthStr} dönemine ait müşteri ve poliçe yedeklerini bulabilirsiniz.`,
      `<p>Merhaba,</p><p>Sistem tarafından oluşturulan <b>${monthStr}</b> dönemi yedek dosyaları ektedir.</p>`,
      [
        { filename: `Musteriler-${monthStr}.xlsx`, path: customerFilePath },
        { filename: `Policeler-${monthStr}.xlsx`, path: policyFilePath }
      ]
    );

    // 4. Mark as done
    fs.writeFileSync(backupFlagFile, new Date().toISOString());
    console.log('Aylık yedekleme tamamlandı ve mail gönderildi.');

  } catch (err) {
    console.error('Yedekleme hatası:', err);
  }
}

async function checkExpirationsAndNotify(force = false) {
  console.log('Poliçe süreleri kontrol ediliyor...');
  const data = await getContext();
  const today = dayjs().startOf('day');
  let sentCount = 0;

  for (const p of data.policies) {
    // Kısa Süreli Trafik hariç
    if (p.policy_type === 'Kısa Süreli Trafik') continue;

    const end = dayjs(p.end_date).startOf('day');
    const days = end.diff(today, 'day');
    
    // 14 Gün Kala
    if ((days === 14 && !p.notified_14) || (force && days === 14)) {
      await sendMail(
        'Poliçe bitimine 14 gün kaldı',
        `Poliçe ${p.policy_number} (${p.customer_name}) ${p.end_date} tarihinde bitecek.\nTelefon: ${p.customer_phone || '-'}`,
        `<p>Poliçe <b>${p.policy_number}</b> (${p.customer_name}) <b>${p.end_date}</b> tarihinde bitecek.</p><p>Telefon: <b>${p.customer_phone || '-'}</b></p>`
      );
      await dataService.updatePolicy(p.id, { notified_14: true });
      sentCount++;
    }

    // 1 Gün Kala
    if ((days === 1 && !p.notified_1) || (force && days === 1)) {
      await sendMail(
        'Poliçe bitimine 1 gün kaldı',
        `Poliçe ${p.policy_number} (${p.customer_name}) yarın (${p.end_date}) bitiyor.\nTelefon: ${p.customer_phone || '-'}`,
        `<p>Poliçe <b>${p.policy_number}</b> (${p.customer_name}) yarın (<b>${p.end_date}</b>) bitiyor.</p><p>Telefon: <b>${p.customer_phone || '-'}</b></p>`
      );
      await dataService.updatePolicy(p.id, { notified_1: true });
      sentCount++;
    }

    // Son Gün (0 Gün Kala)
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

async function checkRemindersAndNotify() {
  console.log('Kişisel hatırlatmalar kontrol ediliyor...');
  const data = await getContext();
  const todayStr = dayjs().format('YYYY-MM-DD');
  const hour = dayjs().hour();
  const isMorningSlot = hour >= 9;
  const isAfternoonSlot = hour >= 14;

  let sentCount = 0;

  if (data.reminders) {
    for (const r of data.reminders) {
      if (r.date !== todayStr) continue;

      // Morning
      if (isMorningSlot && !r.notified_morning) {
        await sendMail(
          'Hatırlatma: ' + r.note.substring(0, 30) + (r.note.length > 30 ? '...' : ''),
          `Hatırlatma Notunuz:\n\n${r.note}\n\nTarih: ${r.date}`,
          `<p>Hatırlatma Notunuz:</p><p><b>${r.note}</b></p><p>Tarih: <b>${r.date}</b></p>`,
          [],
          r.email
        );
        await dataService.updateReminder(r.id, { notified_morning: true });
        sentCount++;
      }

      // Afternoon
      if (isAfternoonSlot && !r.notified_afternoon) {
        await sendMail(
          'Hatırlatma (2. Bildirim): ' + r.note.substring(0, 30) + (r.note.length > 30 ? '...' : ''),
          `Hatırlatma Notunuz (2. Bildirim):\n\n${r.note}\n\nTarih: ${r.date}`,
          `<p>Hatırlatma Notunuz (2. Bildirim):</p><p><b>${r.note}</b></p><p>Tarih: <b>${r.date}</b></p>`,
          [],
          r.email
        );
        await dataService.updateReminder(r.id, { notified_afternoon: true });
        sentCount++;
      }
    }
  }
  
  if (sentCount > 0) {
    console.log(`${sentCount} adet hatırlatma gönderildi.`);
  }
}

// Check every 10 minutes (was 1 hour)
setInterval(() => {
  checkExpirationsAndNotify();
  checkRemindersAndNotify();
  checkAndRunMonthlyBackup();
}, 10 * 60 * 1000);

checkExpirationsAndNotify();
checkRemindersAndNotify();
checkAndRunMonthlyBackup();

// Routes
app.get('/test-mail', requireAuth, async (req, res) => {
  const target = req.query.to || null;
  const result = await sendMail(
    'Test Maili - Sigorta CRM', 
    'Bu bir test mailidir. Sistem ayarlarınız doğru yapılandırılmış görünüyor.', 
    '<p>Bu bir <b>test</b> mailidir.</p><p>Sistem ayarlarınız doğru yapılandırılmış görünüyor.</p>',
    [],
    target
  );
  
  if (result.ok) {
    res.send(`
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px; max-width: 600px; margin: 20px auto; background-color: #d4edda; color: #155724;">
        <h3><i class="bi bi-check-circle"></i> Mail Başarıyla Gönderildi!</h3>
        <p><strong>Gönderilen Adres:</strong> ${result.to}</p>
        <p><strong>Message ID:</strong> ${result.info.messageId}</p>
        <hr>
        <p>Lütfen <strong>${result.to}</strong> adresinin gelen kutusunu ve <strong>Gereksiz/Spam</strong> klasörünü kontrol edin.</p>
        <p>Gmail kullanıyorsanız ve kendinize gönderdiyseniz, bazen "Gelen Kutusu" yerine doğrudan "Tüm Postalar" veya "Gönderilmiş Postalar" altına düşebilir.</p>
        <br>
        <a href="/settings" style="text-decoration: none; background: #198754; color: white; padding: 10px 20px; border-radius: 5px;">Ayarlara Dön</a>
      </div>
    `);
  } else {
    res.send(`
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px; max-width: 600px; margin: 20px auto; background-color: #f8d7da; color: #721c24;">
        <h3><i class="bi bi-exclamation-triangle"></i> Mail Gönderilemedi</h3>
        <p><strong>Hata Detayı:</strong> ${result.error}</p>
        <p><strong>Hedef Adres:</strong> ${result.to}</p>
        <hr>
        <p>Lütfen SMTP ayarlarınızı kontrol edin:</p>
        <ul>
           <li>Gmail Uygulama Şifresi doğru mu? (16 hane, boşluksuz)</li>
           <li>Port 587 ve Secure: Hayır seçili mi?</li>
           <li>Antivirüs programınız giden mailleri engelliyor olabilir mi?</li>
        </ul>
        <br>
        <a href="/settings" style="text-decoration: none; background: #dc3545; color: white; padding: 10px 20px; border-radius: 5px;">Ayarlara Dön</a>
      </div>
    `);
  }
});
app.get('/', async (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  
  const data = await getContext();
  const today = dayjs();
  const startOfWeek = today.startOf('week'); // Note: dayjs startOf week depends on locale, but typically Sunday/Monday
  const endOfWeek = today.endOf('week');
  
  // Dashboard Data
  const policiesEndingToday = data.policies
    .filter(p => dayjs(p.end_date).isSame(today, 'day'))
    .map(p => attachCustomer(p, data));
    
  const policiesEndingThisWeek = data.policies
    .filter(p => {
      const d = dayjs(p.end_date);
      return d.isAfter(today, 'day') && d.isBefore(endOfWeek.add(1, 'day'), 'day');
    })
    .map(p => attachCustomer(p, data));

  const policiesStartingToday = data.policies
    .filter(p => dayjs(p.start_date).isSame(today, 'day'))
    .map(p => attachCustomer(p, data));

  // Custom Reminders (Today or approaching within 3 days maybe? Or just today?)
  // User asked for "specific reminder date". Let's show reminders for today and next 7 days.
  const reminders = data.policies
    .filter(p => p.custom_reminder_date)
    .map(p => ({...attachCustomer(p, data), reminder_date_obj: dayjs(p.custom_reminder_date)}))
    .filter(p => {
       // Show if today or future
       const diff = p.reminder_date_obj.diff(today, 'day');
       return diff >= 0 && diff <= 7;
    })
    .map(p => ({
      ...p, 
      isToday: p.reminder_date_obj.isSame(today, 'day')
    }))
    .sort((a, b) => a.reminder_date_obj.diff(b.reminder_date_obj));

  res.render('dashboard', { 
    title: 'Panel', 
    policiesEndingToday, 
    policiesEndingThisWeek, 
    policiesStartingToday,
    reminders
  });
});

app.get('/login', (req, res) => {
  res.render('auth/login', { title: 'Giriş' });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const data = await getContext();
  const validUser = data.settings?.admin_user || USER;
  const validPass = data.settings?.admin_pass || PASS;
  const users = await dataService.getUsers();
  const existingUser = users.find(u => u.username === username && u.is_active !== false);
  if (existingUser) {
    const ok = await bcrypt.compare(password, existingUser.password_hash);
    if (ok) {
      req.session.user = { id: existingUser._id || existingUser.id, username: existingUser.username, role: existingUser.role, isAdmin: existingUser.role === 'owner' || existingUser.role === 'admin' };
      return res.redirect('/policies');
    }
  }
  if (username === validUser && password === validPass) {
    req.session.user = { username: validUser, role: 'owner', isAdmin: true };
    return res.redirect('/policies');
  }
  res.status(401).render('auth/login', { title: 'Giriş', error: 'Kullanıcı adı veya şifre hatalı' });
});

app.get('/forgot-password', (req, res) => {
  res.render('auth/forgot-password', { title: 'Şifremi Unuttum', msg: null, error: null });
});

app.post('/forgot-password', async (req, res) => {
  const { username, note } = req.body;
  const info = [];
  if (username) info.push(`Kullanıcı adı: ${username}`);
  if (note) info.push(`Not: ${note}`);
  const bodyText = info.join('\n') || 'Kullanıcı şifresini unuttu.';
  const result = await sendMail(
    'Şifre sıfırlama talebi',
    bodyText,
    `<p>Şifre sıfırlama talebi alındı.</p><p>${info.join('<br>') || 'Kullanıcı şifresini unuttu.'}</p>`
  );
  if (!result || !result.ok) {
    return res.render('auth/forgot-password', { title: 'Şifremi Unuttum', msg: null, error: 'Şu anda e-posta gönderilemedi. Lütfen daha sonra tekrar deneyin.' });
  }
  res.render('auth/forgot-password', { title: 'Şifremi Unuttum', msg: 'Talebiniz alındı. En kısa sürede sizinle iletişime geçilecektir.', error: null });
});

app.get('/emergency-reset', (req, res) => {
  res.render('auth/emergency-reset', {
    title: 'Acil Şifre Sıfırlama',
    msg: null,
    error: null,
    isConfigured: !!EMERGENCY_RESET_CODE
  });
});

app.post('/emergency-reset', async (req, res) => {
  const { code, new_username, new_password, new_password_confirm } = req.body;

  if (!EMERGENCY_RESET_CODE) {
    return res.render('auth/emergency-reset', {
      title: 'Acil Şifre Sıfırlama',
      msg: null,
      error: 'Acil şifre sıfırlama kodu tanımlı değil. Lütfen sistem yöneticinizle görüşün.',
      isConfigured: false
    });
  }

  if (!code || !new_username || !new_password || !new_password_confirm) {
    return res.render('auth/emergency-reset', {
      title: 'Acil Şifre Sıfırlama',
      msg: null,
      error: 'Tüm alanları doldurmalısınız.',
      isConfigured: true
    });
  }

  if (new_password !== new_password_confirm) {
    return res.render('auth/emergency-reset', {
      title: 'Acil Şifre Sıfırlama',
      msg: null,
      error: 'Yeni şifre ve tekrarı uyuşmuyor.',
      isConfigured: true
    });
  }

  if (code !== EMERGENCY_RESET_CODE) {
    return res.render('auth/emergency-reset', {
      title: 'Acil Şifre Sıfırlama',
      msg: null,
      error: 'Girdiğiniz acil kod hatalı.',
      isConfigured: true
    });
  }

  await dataService.updateSettings(new_username.trim(), new_password.trim());

  res.render('auth/emergency-reset', {
    title: 'Acil Şifre Sıfırlama',
    msg: 'Yönetici kullanıcı adı ve şifresi başarıyla güncellendi. Giriş ekranından yeni bilgilerinizle giriş yapabilirsiniz.',
    error: null,
    isConfigured: true
  });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// --- Reminders Routes ---
app.get('/reminders', requireAuth, async (req, res) => {
  const data = await getContext();
  const reminders = data.reminders || [];
  // Sort by date desc
  reminders.sort((a, b) => new Date(b.date) - new Date(a.date));
  res.render('reminders/index', { title: 'Hatırlatmalar', reminders });
});

app.post('/reminders', requireAuth, async (req, res) => {
  const { date, note, email } = req.body;
  await dataService.createReminder({
    date,
    note,
    email,
    notified_morning: false,
    notified_afternoon: false
  });
  
  // Trigger check immediately for better UX
  // Don't await this so user doesn't wait for email sending
  checkRemindersAndNotify().catch(err => console.error('Immediate reminder check failed:', err));
  
  res.redirect('/reminders');
});

app.post('/reminders/:id/delete', requireAuth, async (req, res) => {
  await dataService.deleteReminder(Number(req.params.id));
  res.redirect('/reminders');
});

// --- Salespersons Routes ---

app.get('/salespersons', requireAuth, async (req, res) => {
  const data = await getContext();
  const salespersons = data.salespersons || [];
  
  // Calculate stats
  salespersons.forEach(s => {
    const sCustomers = data.customers.filter(c => c.salesperson_id === s.id);
    s.customerCount = sCustomers.length;
    // Policy count: Policies belonging to these customers
    const customerIds = sCustomers.map(c => c.id);
    s.policyCount = data.policies.filter(p => customerIds.includes(p.customer_id)).length;
  });

  res.render('salespersons/index', { title: 'Satışçılar', salespersons });
});

app.get('/salespersons/new', requireAuth, (req, res) => {
  res.render('salespersons/new', { title: 'Yeni Satışçı Ekle' });
});

app.post('/salespersons', requireAuth, async (req, res) => {
  const { name, phone, email, note } = req.body;
  if (!name) return res.send('Ad Soyad zorunludur.');
  
  await dataService.createSalesperson({ name, phone, email, note });
  res.redirect('/salespersons');
});

app.get('/salespersons/:id', requireAuth, async (req, res) => {
  const data = await getContext();
  const salesperson = await dataService.getSalesperson(req.params.id);
  
  if (!salesperson) return res.status(404).send('Satışçı bulunamadı');

  // Customers linked to salesperson
  const customers = data.customers.filter(c => c.salesperson_id === salesperson.id);
  const customerIds = customers.map(c => c.id);

  // Policies linked to salesperson directly OR via customer
  const policies = data.policies.filter(p => 
    p.salesperson_id === salesperson.id || customerIds.includes(p.customer_id)
  ).map(p => {
    const c = data.customers.find(x => x.id === p.customer_id);
    const computed = policyWithComputed(p);
    return { ...computed, customer_name: c ? c.name : 'Bilinmiyor' };
  });

  // Calculate financials
  const payments = await dataService.getSalespersonPayments(salesperson.id);
  const totalCommission = policies.reduce((sum, p) => sum + (p.salesperson_commission || 0), 0);
  const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const balance = totalCommission - totalPaid;
  
  // Satışçının takip ettiği poliçelerden kalan toplam prim borcu
  const totalDebt = policies.reduce((sum, p) => sum + (p.premium_remaining || 0), 0);

  res.render('salespersons/show', { 
    title: 'Satışçı Detayı', 
    salesperson, 
    customers, 
    policies,
    payments,
    stats: { totalCommission, totalPaid, balance, totalDebt }
  });
});

app.post('/salespersons/:id/payments', requireAuth, async (req, res) => {
  const { amount, description, payment_date } = req.body;
  if (!amount || !payment_date) return res.status(400).send('Tutar ve tarih zorunlu');
  
  await dataService.createSalespersonPayment({
    salesperson_id: Number(req.params.id),
    amount: Number(amount),
    description,
    payment_date
  });
  
  res.redirect(`/salespersons/${req.params.id}`);
});

app.get('/salespersons/:id/edit', requireAuth, async (req, res) => {
  const salesperson = await dataService.getSalesperson(req.params.id);
  if (!salesperson) return res.status(404).send('Satışçı bulunamadı');
  res.render('salespersons/edit', { title: 'Satışçı Düzenle', salesperson });
});

app.post('/salespersons/:id', requireAuth, async (req, res) => {
  const { name, phone, email, note } = req.body;
  await dataService.updateSalesperson(req.params.id, { name, phone, email, note });
  res.redirect('/salespersons');
});

app.post('/salespersons/:id/delete', requireAuth, async (req, res) => {
  await dataService.deleteSalesperson(req.params.id);
  res.redirect('/salespersons');
});

app.get('/salespersons/:id/export/customers', requireAuth, async (req, res) => {
  const data = await getContext();
  const salesperson = await dataService.getSalesperson(req.params.id);
  if (!salesperson) return res.status(404).send('Satışçı bulunamadı');

  const customers = data.customers.filter(c => c.salesperson_id === salesperson.id);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Musteriler');
  ws.columns = [
    { header: 'Adı Soyadı', key: 'name', width: 25 },
    { header: 'Telefon', key: 'phone', width: 15 },
    { header: 'TCKN/Vergi No', key: 'id_no', width: 15 },
    { header: 'Meslek', key: 'profession', width: 20 },
    { header: 'Not', key: 'note', width: 30 }
  ];

  customers.forEach(c => {
    ws.addRow({
      name: c.name,
      phone: c.phone,
      id_no: c.id_no,
      profession: c.profession,
      note: c.note
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Satisci_${salesperson.name.replace(/[^a-z0-9]/gi, '_')}_Musteriler.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

app.get('/salespersons/:id/export/policies', requireAuth, async (req, res) => {
  const data = await getContext();
  const salesperson = await dataService.getSalesperson(req.params.id);
  if (!salesperson) return res.status(404).send('Satışçı bulunamadı');

  const customers = data.customers.filter(c => c.salesperson_id === salesperson.id);
  const customerIds = customers.map(c => c.id);
  const policies = data.policies
    .filter(p => customerIds.includes(p.customer_id))
    .map(p => {
        const c = customers.find(x => x.id === p.customer_id);
        return { ...p, customer_name: c ? c.name : 'Bilinmiyor' };
    });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Policeler');
  ws.columns = [
    { header: 'Müşteri', key: 'customer', width: 25 },
    { header: 'Poliçe No', key: 'policy_number', width: 20 },
    { header: 'Şirket', key: 'insurer', width: 20 },
    { header: 'Tür', key: 'policy_type', width: 15 },
    { header: 'Bitiş Tarihi', key: 'end_date', width: 15 },
    { header: 'Prim', key: 'premium', width: 15 },
    { header: 'Durum', key: 'status', width: 15 }
  ];

  policies.forEach(p => {
    ws.addRow({
      customer: p.customer_name,
      policy_number: p.policy_number,
      insurer: p.insurer,
      policy_type: p.policy_type,
      end_date: p.end_date,
      premium: p.premium,
      status: p.status
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Satisci_${salesperson.name.replace(/[^a-z0-9]/gi, '_')}_Policeler.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// --- End Salespersons Routes ---

app.get('/settings', requireAuth, requireAdmin, async (req, res) => {
  const data = await getContext();
  const settings = data.settings || {};

  // Fill in defaults from Env Vars for display if DB is empty
  if (!settings.smtp_host) settings.smtp_host = process.env.SMTP_HOST;
  if (!settings.smtp_port) settings.smtp_port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
  if (!settings.smtp_user) settings.smtp_user = process.env.SMTP_USER;
  // Don't show password for security, or show placeholder? Better to leave empty or show if user wants.
  // if (!settings.smtp_pass) settings.smtp_pass = process.env.SMTP_PASS; 
  if (settings.smtp_secure === undefined && process.env.SMTP_SECURE) settings.smtp_secure = process.env.SMTP_SECURE === 'true';
  if (!settings.app_url) settings.app_url = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL;

  res.render('settings', { 
    title: 'Ayarlar', 
    msg: req.query.msg, 
    error: req.query.error,
    settings: settings,
    smtpError: lastSmtpError
  });
});

app.post('/settings', requireAuth, requireAdmin, async (req, res) => {
  const data = await getContext();
  
  if (req.body.action === 'smtp') {
    const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure, smtp_from, notification_email, app_url } = req.body;
    
    const smtpSettings = {
        smtp_host: smtp_host ? smtp_host.trim() : '',
        smtp_port: Number(smtp_port) || 587,
        smtp_user: smtp_user ? smtp_user.trim() : '',
        smtp_pass: smtp_pass ? smtp_pass.trim() : '',
        smtp_secure: smtp_secure === 'true',
        smtp_from: smtp_from ? smtp_from.trim() : '',
        notification_email: notification_email ? notification_email.trim() : '',
        app_url: app_url ? app_url.trim() : ''
    };
    
    // Preserve existing admin credentials
    const currentUsername = data.settings?.admin_user || USER;
    const currentPassword = data.settings?.admin_pass || PASS;
    
    await dataService.updateSettings(currentUsername, currentPassword, smtpSettings);
    
    // Re-initialize mailer with new settings
    await initMailer();
    
    return res.redirect('/settings?msg=' + encodeURIComponent('SMTP ayarları kaydedildi ve mailer yeniden başlatıldı.'));
  }

  // Account Update (Default)
  const { old_password, new_username, new_password } = req.body;
  const currentUser = req.session.user;
  const currentPass = data.settings?.admin_pass || PASS;

  if (!old_password || old_password !== currentPass) {
    return res.redirect('/settings?error=' + encodeURIComponent('Mevcut şifre hatalı.'));
  }

  const finalUsername = new_username && new_username.trim() ? new_username.trim() : (data.settings?.admin_user || USER);
  const finalPassword = new_password && new_password.trim() ? new_password.trim() : currentPass;
  
  // Preserve existing SMTP settings
  const currentSmtp = {
      smtp_host: data.settings?.smtp_host,
      smtp_port: data.settings?.smtp_port,
      smtp_user: data.settings?.smtp_user,
      smtp_pass: data.settings?.smtp_pass,
      smtp_secure: data.settings?.smtp_secure,
      smtp_from: data.settings?.smtp_from,
      notification_email: data.settings?.notification_email,
      app_url: data.settings?.app_url
  };

  await dataService.updateSettings(finalUsername, finalPassword, currentSmtp);
  req.session.user.username = finalUsername;
  res.redirect('/settings?msg=' + encodeURIComponent('Bilgiler başarıyla güncellendi.'));
});

app.get('/users', requireAuth, requireAdmin, async (req, res) => {
  const users = await dataService.getUsers();
  res.render('users/index', { title: 'Kullanıcılar', users, msg: req.query.msg, error: req.query.error });
});

app.get('/users/new', requireAuth, requireAdmin, (req, res) => {
  res.render('users/new', { title: 'Yeni Kullanıcı' });
});

app.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.redirect('/users?error=' + encodeURIComponent('Kullanıcı adı ve şifre zorunlu.'));
  }
  const existing = await dataService.getUserByUsername(username.trim());
  if (existing) {
    return res.redirect('/users?error=' + encodeURIComponent('Bu kullanıcı adı zaten kullanılıyor.'));
  }
  const hash = await bcrypt.hash(password, 10);
  await dataService.createUser({
    username: username.trim(),
    password_hash: hash,
    role: role === 'admin' ? 'admin' : 'user',
    is_active: true
  });
  res.redirect('/users?msg=' + encodeURIComponent('Kullanıcı oluşturuldu.'));
});

app.get('/users/:id/edit', requireAuth, requireAdmin, async (req, res) => {
  const users = await dataService.getUsers();
  const user = users.find(u => String(u._id || u.id) === req.params.id);
  if (!user) return res.status(404).send('Kullanıcı bulunamadı');
  res.render('users/edit', { title: 'Kullanıcı Düzenle', user });
});

app.post('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const users = await dataService.getUsers();
  const user = users.find(u => String(u._id || u.id) === req.params.id);
  if (!user) return res.status(404).send('Kullanıcı bulunamadı');
  const updates = {};
  if (user.role !== 'owner') {
    if (req.body.username && req.body.username.trim()) {
      updates.username = req.body.username.trim();
    }
    if (req.body.role === 'admin' || req.body.role === 'user') {
      updates.role = req.body.role;
    }
  }
  if (req.body.password && req.body.password.trim()) {
    const hash = await bcrypt.hash(req.body.password.trim(), 10);
    updates.password_hash = hash;
  }
  updates.is_active = req.body.is_active === 'false' ? false : true;
  await dataService.updateUser(user._id || user.id, updates);
  res.redirect('/users?msg=' + encodeURIComponent('Kullanıcı güncellendi.'));
});

app.post('/users/:id/delete', requireAuth, requireAdmin, async (req, res) => {
  const users = await dataService.getUsers();
  const user = users.find(u => String(u._id || u.id) === req.params.id);
  if (!user) return res.status(404).send('Kullanıcı bulunamadı');
  if (user.role === 'owner') {
    return res.redirect('/users?error=' + encodeURIComponent('Ana kullanıcı silinemez.'));
  }
  await dataService.deleteUser(user._id || user.id);
  res.redirect('/users?msg=' + encodeURIComponent('Kullanıcı silindi.'));
});

app.get('/customers', requireAuth, async (req, res) => {
  const data = await getContext();
  const q = (req.query.q || '').toLocaleLowerCase('tr-TR');
  const birthdaysFilter = req.query.birthdays === 'today';
  const debtorsFilter = req.query.filter === 'debtors';

  let customers = data.customers.map(c => {
    // Hesaplama: (Toplam Poliçe Primi - Poliçe Ödenen) + Manuel Borç - Genel Tahsilatlar
    const cPolicies = data.policies.filter(p => p.customer_id === c.id);
    const cPayments = data.payments ? data.payments.filter(p => p.customer_id === c.id) : [];
    
    const totalPremium = cPolicies.reduce((sum, p) => sum + Number(p.premium || 0), 0);
    const totalPaidPolicy = cPolicies.reduce((sum, p) => sum + Number(p.premium_paid || 0), 0);
    const totalCollections = cPayments.reduce((sum, pay) => sum + Number(pay.amount || 0), 0);
    const manualDebt = Number(c.manual_debt || 0);

    const balance = (totalPremium - totalPaidPolicy) + manualDebt - totalCollections;
    return { ...c, balance };
  });

  if (q) {
    customers = customers.filter(c =>
      (c.name || '').toLocaleLowerCase('tr-TR').includes(q) ||
      (c.phone || '').toLocaleLowerCase('tr-TR').includes(q) ||
      (c.id_no || '').toLocaleLowerCase('tr-TR').includes(q) ||
      (c.email || '').toLocaleLowerCase('tr-TR').includes(q) ||
      (c.plate || '').toLocaleLowerCase('tr-TR').includes(q) ||
      data.policies.some(p =>
        p.customer_id === c.id && (
          (p.policy_number || '').toLocaleLowerCase('tr-TR').includes(q) ||
          (p.policy_details && p.policy_details.plate && p.policy_details.plate.toLocaleLowerCase('tr-TR').includes(q))
        )
      )
    );
  }
  if (birthdaysFilter) {
    const today = dayjs();
    customers = customers.filter(c => {
      if (!c.birth_date) return false;
      const d = dayjs(c.birth_date);
      if (!d.isValid()) return false;
      return d.date() === today.date() && d.month() === today.month();
    });
  }
  if (debtorsFilter) {
    customers = customers.filter(c => Math.abs(c.balance) > 0.01);
  }

  const qs = new URLSearchParams(req.query).toString();

  // Borçlular/Alacaklılar Sayfası için İstatistikler
  let totalReceivable = 0; // Bizim alacağımız (Müşterinin borcu) -> balance > 0
  let totalPayable = 0;    // Bizim borcumuz (Müşterinin alacağı) -> balance < 0
  
  if (debtorsFilter) {
    totalReceivable = customers
      .filter(c => c.balance > 0)
      .reduce((sum, c) => sum + c.balance, 0);
      
    totalPayable = customers
      .filter(c => c.balance < 0)
      .reduce((sum, c) => sum + Math.abs(c.balance), 0);
  }

  res.render('customers/index', { 
    title: debtorsFilter ? 'Bakiye Listesi' : (birthdaysFilter ? 'Doğum Günü Olan Müşteriler' : 'Müşteriler'), 
    customers, 
    q, 
    birthdaysFilter, 
    debtorsFilter,
    qs,
    totalReceivable,
    totalPayable
  });
});

app.get('/customers/export.xlsx', requireAuth, async (req, res) => {
  const data = await getContext();
  const q = (req.query.q || '').toLocaleLowerCase('tr-TR');
  const birthdaysFilter = req.query.birthdays === 'today';
  const debtorsFilter = req.query.filter === 'debtors';

  let customers = data.customers.map(c => {
    const cPolicies = data.policies.filter(p => p.customer_id === c.id);
    const cPayments = data.payments ? data.payments.filter(p => p.customer_id === c.id) : [];
    
    const totalPremium = cPolicies.reduce((sum, p) => sum + Number(p.premium || 0), 0);
    const totalPaidPolicy = cPolicies.reduce((sum, p) => sum + Number(p.premium_paid || 0), 0);
    const totalCollections = cPayments.reduce((sum, pay) => sum + Number(pay.amount || 0), 0);
    const manualDebt = Number(c.manual_debt || 0);

    const balance = (totalPremium - totalPaidPolicy) + manualDebt - totalCollections;
    return { ...c, balance };
  });

  if (q) {
    customers = customers.filter(c =>
      (c.name || '').toLocaleLowerCase('tr-TR').includes(q) ||
      (c.phone || '').toLocaleLowerCase('tr-TR').includes(q) ||
      (c.id_no || '').toLocaleLowerCase('tr-TR').includes(q) ||
      (c.email || '').toLocaleLowerCase('tr-TR').includes(q) ||
      (c.plate || '').toLocaleLowerCase('tr-TR').includes(q) ||
      data.policies.some(p =>
        p.customer_id === c.id && (
          (p.policy_number || '').toLocaleLowerCase('tr-TR').includes(q) ||
          (p.policy_details && p.policy_details.plate && p.policy_details.plate.toLocaleLowerCase('tr-TR').includes(q))
        )
      )
    );
  }
  if (birthdaysFilter) {
    const today = dayjs();
    customers = customers.filter(c => {
      if (!c.birth_date) return false;
      const d = dayjs(c.birth_date);
      if (!d.isValid()) return false;
      return d.date() === today.date() && d.month() === today.month();
    });
  }
  if (debtorsFilter) {
    customers = customers.filter(c => Math.abs(c.balance) > 0.01);
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Müşteriler');
  
  // 1. Satır Yapısını Değiştir: Müşteri -> Poliçeler
  // Her poliçe için ayrı satır oluşturacağız. Poliçesi olmayanlar tek satır.
  const exportRows = [];

  for (const c of customers) {
    // Müşterinin poliçelerini bul
    const cPolicies = data.policies.filter(p => p.customer_id === c.id);

    if (cPolicies.length === 0) {
      // Poliçesi yoksa sadece müşteri bilgilerini ekle, poliçe alanları boş kalsın
      exportRows.push({
        name: c.name,
        id_no: c.id_no,
        phone: c.phone,
        issue_date: '',
        end_date: '',
        plate: '',
        registration_no: '',
        profession: c.profession || '',
        building_age: '',
        area_sqm: '',
        address_code: '',
        balance: c.balance
      });
    } else {
      // Her poliçe için satır ekle
      for (const p of cPolicies) {
        const details = p.policy_details || {};
        
        // Plaka: Detaylarda varsa oradan, yoksa açıklamadan bulmaya çalış
        let plate = details.plate || '';
        if (!plate && p.description) {
          const match = p.description.match(/Plaka:\s*([^\s,]+)/i);
          if (match) plate = match[1];
        }

        // Ruhsat No
        let registration_no = details.registration_no || '';

        // Meslek: Önce müşterinin kendi mesleği, yoksa poliçe detayı
        let profession = c.profession || details.profession || '';
        
        // DASK/Konut alanları
        let building_age = details.building_age || '';
        let area_sqm = details.area_sqm || '';
        let address_code = details.address_code || '';

        exportRows.push({
          name: c.name,
          id_no: c.id_no,
          phone: c.phone,
          issue_date: p.issue_date || p.start_date || '', // Tanzim Tarihi (Yoksa Başlangıç)
          end_date: p.end_date || '',
          plate: plate,
          registration_no: registration_no,
          profession: profession,
          building_age: building_age,
          area_sqm: area_sqm,
          address_code: address_code,
          balance: c.balance
        });
      }
    }
  }

  ws.columns = [
    { header: 'Adı Soyadı', key: 'name', width: 25 },
    { header: 'TC Kimlik No', key: 'id_no', width: 16 },
    { header: 'Telefon', key: 'phone', width: 16 },
    { header: 'Tanzim Tarihi', key: 'issue_date', width: 15 },
    { header: 'Bitiş Tarihi', key: 'end_date', width: 15 },
    { header: 'Plaka', key: 'plate', width: 15 },
    { header: 'Ruhsat Tescil No', key: 'registration_no', width: 20 },
    { header: 'Meslek', key: 'profession', width: 20 },
    { header: 'Bina Yaşı', key: 'building_age', width: 10 },
    { header: 'Metrekare', key: 'area_sqm', width: 10 },
    { header: 'Adres Kodu', key: 'address_code', width: 15 },
    { header: 'Bakiye', key: 'balance', width: 15 }
  ];

  for (const row of exportRows) {
    ws.addRow(row);
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=\"musteriler.xlsx\"');
  await wb.xlsx.write(res);
  res.end();
});

app.get('/customers/new', requireAuth, async (req, res) => {
  const data = await getContext();
  const salespersons = data.salespersons || [];
  res.render('customers/new', { title: 'Yeni Müşteri', salespersons });
});

app.post('/customers', requireAuth, async (req, res) => {
  const { name, phone, id_no, email, birth_date, salesperson_id } = req.body;
  if (!name) return res.status(400).send('Müşteri adı zorunlu');
  
  const data = await getContext();
  if (id_no) {
    const existing = data.customers.find(c => c.id_no === id_no);
    if (existing) {
      return res.status(400).send(`Bu TC/VKN ile kayıtlı müşteri zaten var: ${existing.name}`);
    }
  }

  await dataService.createCustomer({
    name,
    phone: phone || '',
    id_no: id_no || '',
    email: email || '',
    profession: req.body.profession || '',
    birth_date: birth_date || '',
    salesperson_id: salesperson_id ? Number(salesperson_id) : null,
    manual_debt: Number(req.body.manual_debt) || 0,
    note: req.body.note || ''
  });
  res.redirect('/customers');
});

app.get('/customers/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const data = await getContext();
  const customer = data.customers.find(x => x.id === id);
  
  if (!customer) return res.status(404).send('Müşteri bulunamadı');

  let salespersonName = '-';
  if (customer.salesperson_id) {
    const sp = data.salespersons ? data.salespersons.find(s => s.id === customer.salesperson_id) : null;
    if (sp) salespersonName = sp.name;
  }

  // Müşteriye ait poliçeleri bul ve hesaplamaları yap
  const policies = data.policies
    .filter(p => p.customer_id === id)
    .map(p => policyWithComputed(p))
    .sort((a, b) => a.end_date.localeCompare(b.end_date) || b.id - a.id);

  const payments = await dataService.getPaymentsByCustomer(id);

  // İstatistikler
  const totalCollections = payments.reduce((sum, pay) => sum + Number(pay.amount || 0), 0);
  const manualDebt = Number(customer.manual_debt || 0);

  const stats = {
    totalPolicies: policies.length,
    activePolicies: policies.filter(p => !p.is_expired && (p.status === 'active' || p.status === 'Aktif')).length,
    expiredPolicies: policies.filter(p => p.is_expired).length,
    totalPremium: policies.reduce((sum, p) => sum + Number(p.premium_total || 0), 0),
    totalPaidPolicy: policies.reduce((sum, p) => sum + Number(p.premium_paid || 0), 0),
    totalCollections,
    manualDebt
  };

  // Eski (Hatalı) Kod:
  // stats.totalRemaining = stats.manualDebt - stats.totalCollections;

  // Yeni (Doğru) Kod:
  // Toplam Poliçe Borcu = (Toplam Prim - Poliçe Bazlı Ödenen)
  const totalPolicyDebt = stats.totalPremium - stats.totalPaidPolicy;
  // Genel Kalan = Poliçe Borçları + Manuel Borç - Genel Tahsilatlar
  stats.totalRemaining = totalPolicyDebt + stats.manualDebt - stats.totalCollections;

  // Poliçe Dağılımı Hesapla
  const policyDistribution = {};
  policies.forEach(p => {
    const type = p.policy_type || 'Diğer';
    if (!policyDistribution[type]) {
      policyDistribution[type] = 0;
    }
    policyDistribution[type]++;
  });

  res.render('customers/show', { 
    title: 'Müşteri Detayı',  
    customer, 
    policies,
  payments,
    stats,
    policyDistribution,
    salespersonName
  });
});

app.get('/customers/:id/invoice', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const data = await getContext();
  const customer = data.customers.find(x => x.id === id);
  if (!customer) return res.status(404).send('Müşteri bulunamadı');

  const policies = data.policies
    .filter(p => p.customer_id === id)
    .map(p => policyWithComputed(p))
    .sort((a, b) => a.end_date.localeCompare(b.end_date) || b.id - a.id);

  const payments = await dataService.getPaymentsByCustomer(id);
  // Toplam Tahsilat (Poliçeye uygulanmamış kısım "Bakiye/Kredi" olarak sayılır)
  // applied_amount düşülür ki çift sayım olmasın (poliçeye işlenen kısım zaten totalPaidPolicy içinde)
  const totalCollections = payments.reduce((sum, pay) => sum + (Number(pay.amount || 0) - Number(pay.applied_amount || 0)), 0);
  const manualDebt = Number(customer.manual_debt || 0);

  const stats = {
    totalPolicies: policies.length,
    activePolicies: policies.filter(p => !p.is_expired && (p.status === 'active' || p.status === 'Aktif')).length,
    expiredPolicies: policies.filter(p => p.is_expired).length,
    totalPremium: policies.reduce((sum, p) => sum + Number(p.premium_total || 0), 0),
    totalPaidPolicy: policies.reduce((sum, p) => sum + Number(p.premium_paid || 0), 0),
    totalCollections,
    manualDebt
  };
  
  // Yeni (Doğru) Hesaplama:
  // Toplam Alacak = Tüm Poliçe Primleri + Manuel Borç
  stats.totalReceivable = stats.totalPremium + stats.manualDebt;

  // Toplam Ödenen = Poliçe Bazlı Ödenenler + Genel Tahsilatlar
  stats.totalPaidAll = stats.totalPaidPolicy + stats.totalCollections;

  // Kalan Bakiye
  stats.totalRemaining = stats.totalReceivable - stats.totalPaidAll;

  // Belirli bir ödeme (makbuz) isteniyorsa
  let selectedPayment = null;
  if (req.query.payment_id) {
    const payId = Number(req.query.payment_id);
    selectedPayment = payments.find(p => p.id === payId);
  }

  const targetPolicyId = req.query.policy_id ? Number(req.query.policy_id) : null;

  res.render('customers/invoice', {
    title: 'Fatura / Tahsilat',
    customer,
    policies,
    payments,
    stats,
    today: selectedPayment ? selectedPayment.date : dayjs().format('YYYY-MM-DD'),
    msg: req.query.msg || null,
    error: req.query.error || null,
    selectedPayment,
    targetPolicyId
  });
});

app.post('/customers/:id/invoice', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const data = await getContext();
  const customer = data.customers.find(x => x.id === id);
  if (!customer) return res.status(404).send('Müşteri bulunamadı');

  const paidRaw = req.body.paid || '';
  const note = req.body.note || '';
  const date = req.body.date || '';
  const amount = parseFloat(String(paidRaw).replace(',', '.')) || 0;
  const targetPolicyId = req.body.target_policy_id ? Number(req.body.target_policy_id) : null;

  if (!amount || amount <= 0) {
    return res.redirect('/customers/' + id + '/invoice?error=' + encodeURIComponent('Geçerli bir tahsilat tutarı girin.'));
  }

  // 1. Ödemeyi poliçe borçlarına dağıt
  const customerPolicies = data.policies.filter(p => p.customer_id === id);
  customerPolicies.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

  let remainingToDistribute = amount;
  let totalApplied = 0;

  // A. Eğer hedef poliçe seçildiyse önce ona uygula
  if (targetPolicyId) {
    const targetPolicy = customerPolicies.find(p => p.id === targetPolicyId);
    if (targetPolicy) {
      const pTotal = Number(targetPolicy.premium || 0);
      const pPaid = Number(targetPolicy.premium_paid || 0);
      const pDebt = pTotal - pPaid;

      if (pDebt > 0) {
        const cover = Math.min(pDebt, remainingToDistribute);
        const newPaid = pPaid + cover;
        
        await dataService.updatePolicy(targetPolicy.id, { premium_paid: newPaid });
        
        remainingToDistribute -= cover;
        totalApplied += cover;
        
        // Update local object for next loop check to avoid double counting if logic changes
        targetPolicy.premium_paid = newPaid; 
      }
    }
  }

  // B. Kalan tutarı diğer poliçelere (eskiden yeniye) dağıt
  for (const p of customerPolicies) {
    if (remainingToDistribute <= 0.01) break; // Float hassasiyeti için küçük eşik
    
    // Eğer hedef poliçeye zaten uyguladıysak tekrar uygulama (veya kalan borç varsa uygula)
    // Yukarıda premium_paid güncellendiği için pDebt tekrar hesaplanmalı
    const pTotal = Number(p.premium || 0);
    // Reload current state just in case or use updated object
    // Since we are iterating objects from memory that we might have just updated via dataService,
    // we should rely on the object reference 'p' which we updated manually above if it was the target.
    // Wait, I updated 'targetPolicy.premium_paid = newPaid'. targetPolicy IS 'p' (reference).
    // So 'p.premium_paid' is up to date.
    
    const pPaid = Number(p.premium_paid || 0);
    const pDebt = pTotal - pPaid;

    if (pDebt > 0) {
      const cover = Math.min(pDebt, remainingToDistribute);
      const newPaid = pPaid + cover;
      
      await dataService.updatePolicy(p.id, { premium_paid: newPaid });
      
      // Update in memory for loop consistency
      p.premium_paid = newPaid;

      remainingToDistribute -= cover;
      totalApplied += cover;
    }
  }

  const finalDate = date || new Date().toISOString().slice(0, 10);
  await dataService.createPayment({
    customer_id: id,
    amount,
    applied_amount: totalApplied,
    note,
    date: finalDate
  });

  res.redirect('/customers/' + id + '/invoice?msg=' + encodeURIComponent('Tahsilat kaydedildi ve ' + totalApplied.toFixed(2) + ' TL poliçe borçlarından düşüldü.'));
});

app.post('/payments/:id/delete', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const customerId = Number(req.body.customer_id);
  if (!customerId) {
    return res.status(400).send('Geçersiz istek');
  }
  await dataService.deletePayment(id);
  res.redirect('/customers/' + customerId);
});

app.get('/customers/:id/edit', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const data = await getContext();
  const c = data.customers.find(x => x.id === id);
  if (!c) return res.status(404).send('Müşteri bulunamadı');
  const salespersons = data.salespersons || [];
  res.render('customers/edit', { title: 'Müşteri Düzenle', customer: c, salespersons });
});

app.get('/customers/:id/vehicles/export.xlsx', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const data = await getContext();
  const c = data.customers.find(x => x.id === id);
  if (!c) return res.status(404).send('Müşteri bulunamadı');

  // Müşteriye ait poliçelerden plaka listesini ve detaylarını çıkar
  const policies = data.policies.filter(p => p.customer_id === id);
  const vehiclesMap = new Map();
  
  policies.forEach(p => {
    if (p.policy_details && p.policy_details.plate) {
      const plate = p.policy_details.plate.trim().toUpperCase();
      const existing = vehiclesMap.get(plate) || {};
      
      // Update with new info if available (or if existing is empty)
      const newInfo = {
        plate: plate,
        registration_no: p.policy_details.registration_no || existing.registration_no || '',
        vehicle_type: p.policy_details.vehicle_type || existing.vehicle_type || ''
      };
      
      vehiclesMap.set(plate, newInfo);
    }
  });

  const vehicleList = Array.from(vehiclesMap.values()).sort((a, b) => a.plate.localeCompare(b.plate));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Kayıtlı Araçlar');
  
  ws.columns = [
    { header: 'Sıra No', key: 'index', width: 10 },
    { header: 'Plaka', key: 'plate', width: 15 },
    { header: 'Ruhsat Tescil No', key: 'reg_no', width: 20 },
    { header: 'Araç Cinsi', key: 'type', width: 20 },
    { header: 'Müşteri Adı', key: 'customer', width: 30 }
  ];

  vehicleList.forEach((v, index) => {
    ws.addRow({
      index: index + 1,
      plate: v.plate,
      reg_no: v.registration_no,
      type: v.vehicle_type,
      customer: c.name
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Arac_Listesi_${c.name.replace(/[^a-z0-9]/gi, '_')}.xlsx"`);

  await wb.xlsx.write(res);
  res.end();
});

app.post('/customers/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const currentUser = req.session.user;
  if (currentUser && currentUser.isAdmin) {
    await dataService.updateCustomer(id, {
      name: req.body.name,
      phone: req.body.phone,
      id_no: req.body.id_no,
      email: req.body.email,
      profession: req.body.profession,
      birth_date: req.body.birth_date,
      salesperson_id: req.body.salesperson_id ? Number(req.body.salesperson_id) : null,
      manual_debt: Number(req.body.manual_debt) || 0,
      note: req.body.note || ''
    });
  } else {
    await dataService.updateCustomer(id, {
      phone: req.body.phone,
      salesperson_id: req.body.salesperson_id ? Number(req.body.salesperson_id) : null
    });
  }
  res.redirect('/customers');
});

app.post('/customers/:id/delete', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const data = await getContext();
  const anyPolicy = data.policies.some(p => p.customer_id === id);
  if (anyPolicy) {
    return res.status(400).send('Bu müşteriye bağlı poliçe mevcut; silmeden önce poliçeleri kaldırın.');
  }
  await dataService.deleteCustomer(id);
  res.redirect('/customers');
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
      const description = row.getCell(10).text;
      const status = row.getCell(11).text;

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
  const salespersons = data.salespersons || [];
  res.render('policies/new', { title: 'Yeni Poliçe', customers: data.customers, salespersons });
});

app.get('/policies/renew/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const data = await getContext();
  const oldPolicy = data.policies.find(p => p.id === id);
  
  if (!oldPolicy) return res.status(404).send('Poliçe bulunamadı');

  // Yenileme için ön dolum verileri
  // Kullanıcı isteği: Tanzim tarihi, şirket ve poliçe no boş gelsin, diğerleri dolu gelsin.
  const prefill = {
    customer_id: oldPolicy.customer_id,
    salesperson_id: oldPolicy.salesperson_id,
    policy_type: oldPolicy.policy_type,
    description: oldPolicy.description,
    policy_details: oldPolicy.policy_details || {},
    // Şirket, Poliçe No boş bırakılıyor (manuel giriş için)
    insurer: '',
    policy_number: '',
    issue_date: '',
    // Yeni Başlangıç Tarihi = Eski Bitiş Tarihi
    start_date: oldPolicy.end_date || '',
    // Yeni Bitiş Tarihi = Eski Bitiş Tarihi + 1 Yıl
    end_date: oldPolicy.end_date ? dayjs(oldPolicy.end_date).add(1, 'year').format('YYYY-MM-DD') : '',
    // Parasal tutarlar boş bırakılıyor (Kullanıcı isteği)
    premium: '',
    premium_paid: '', 
    payment_note: '',
    commission: '',
    commission_refund: '',
    salesperson_commission: '',
    custom_reminder_date: '',
    custom_reminder_note: ''
  };

  const salespersons = data.salespersons || [];
  res.render('policies/new', { 
    title: 'Poliçe Yenile', 
    customers: data.customers, 
    salespersons, 
    prefill 
  });
});

app.post('/policies', requireAuth, async (req, res) => {
  try {
    const { customer_id, insurer, policy_number, start_date, end_date, description, status, issue_date, policy_type, premium, premium_paid, payment_note, commission, commission_refund, custom_reminder_date, custom_reminder_note, salesperson_commission, salesperson_id } = req.body;
    
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
      premium: premium ? Number(premium) : undefined,
      premium_paid: premium_paid ? Number(premium_paid) : undefined,
      payment_note: payment_note || '',
      commission: commission ? Number(commission) : undefined,
      commission_refund: commission_refund ? Number(commission_refund) : undefined,
      salesperson_commission: salesperson_commission ? Number(salesperson_commission) : undefined,
      salesperson_id: salesperson_id ? Number(salesperson_id) : undefined,
      custom_reminder_date: custom_reminder_date || '',
      custom_reminder_note: custom_reminder_note || '',
      status: status || 'active',
      created_at,
      notified_14: false,
      notified_end: false,
      policy_details: req.body.policy_details || {}
    });
    res.redirect('/policies');
  } catch (err) {
    console.error(err);
    res.status(500).send('Poliçe oluşturulurken hata oluştu: ' + err.message);
  }
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
    { header: 'Poliçe Detayları', key: 'description', width: 30 },
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
  const salespersons = data.salespersons || [];
  res.render('policies/edit', { title: 'Poliçe Düzenle', policy: p, customers: data.customers, salespersons });
});

app.post('/policies/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { customer_id, insurer, policy_number, start_date, end_date, description, status, issue_date, policy_type, premium, premium_paid, payment_note, commission, commission_refund, custom_reminder_date, custom_reminder_note, salesperson_commission, salesperson_id } = req.body;
    
    await dataService.updatePolicy(id, {
      customer_id: Number(customer_id),
      insurer,
      policy_number,
      issue_date: issue_date || '',
      start_date,
      end_date,
      description: description || '',
      policy_type: policy_type || 'Diğer',
      premium: premium ? Number(premium) : undefined,
      premium_paid: premium_paid ? Number(premium_paid) : undefined,
      payment_note: payment_note || '',
      commission: commission ? Number(commission) : undefined,
      commission_refund: commission_refund ? Number(commission_refund) : undefined,
      salesperson_commission: salesperson_commission ? Number(salesperson_commission) : undefined,
      salesperson_id: salesperson_id ? Number(salesperson_id) : null,
      custom_reminder_date: custom_reminder_date || '',
      custom_reminder_note: custom_reminder_note || '',
      status: status || 'active',
      policy_details: req.body.policy_details || {}
    });
    res.redirect('/policies/' + id);
  } catch (err) {
    console.error(err);
    res.status(500).send('Poliçe güncellenirken hata oluştu: ' + err.message);
  }
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
  if (process.env.ALLOW_RESET !== 'true') {
    return res.status(403).send('Veri sıfırlama devre dışı');
  }
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
  const data = await getContext();
  const salespersons = data.salespersons || [];
  const items = await filterPolicies(req.query);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Poliçeler');
  ws.columns = [
    { header: 'Adı Soyadı', key: 'name', width: 25 },
    { header: 'TC Kimlik No', key: 'id_no', width: 16 },
    { header: 'Telefon', key: 'phone', width: 16 },
    { header: 'Satışçı', key: 'salesperson', width: 20 },
    { header: 'Tanzim Tarihi', key: 'issue_date', width: 15 },
    { header: 'Bitiş Tarihi', key: 'end_date', width: 15 },
    { header: 'Plaka', key: 'plate', width: 15 },
    { header: 'Ruhsat Tescil No', key: 'registration_no', width: 20 },
    { header: 'Meslek', key: 'profession', width: 20 },
    { header: 'Bina Yaşı', key: 'building_age', width: 10 },
    { header: 'Metrekare', key: 'area_sqm', width: 10 },
    { header: 'Adres Kodu', key: 'address_code', width: 15 },
    { header: 'Poliçe Türü', key: 'policy_type', width: 15 },
    { header: 'Poliçe No', key: 'policy_number', width: 20 },
    { header: 'Durum', key: 'status', width: 15 },
    { header: 'Kalan Gün', key: 'days_left', width: 10 }
  ];
  
  for (const p of items) {
    const comp = policyWithComputed(p);
    const details = p.policy_details || {};
    
    // Satışçı Bul
    let salespersonName = '';
    if (p.salesperson_id) {
      const sp = salespersons.find(s => s.id === p.salesperson_id);
      if (sp) salespersonName = sp.name;
    }

    // Plaka: Detaylarda varsa oradan, yoksa açıklamadan bulmaya çalış
    let plate = details.plate || '';
    if (!plate && p.description) {
      const match = p.description.match(/Plaka:\s*([^\s,]+)/i);
      if (match) plate = match[1];
    }

    // Ruhsat No
    let registration_no = details.registration_no || '';

    // Meslek (Sadece Kasko ise veya varsa)
    let profession = details.profession || '';

    // DASK/Konut alanları
    let building_age = details.building_age || '';
    let area_sqm = details.area_sqm || '';
    let address_code = details.address_code || '';

    ws.addRow({
      name: comp.customer_name,
      id_no: comp.customer_id_no,
      phone: comp.customer_phone,
      salesperson: salespersonName,
      issue_date: p.issue_date || p.start_date || '', // Tanzim Tarihi
      end_date: comp.end_date,
      plate: plate,
      registration_no: registration_no,
      profession: profession,
      building_age: building_age,
      area_sqm: area_sqm,
      address_code: address_code,
      policy_type: comp.policy_type,
      policy_number: comp.policy_number,
      status: comp.status === 'active' ? 'Aktif' : (comp.status === 'cancelled' ? 'İptal' : comp.status),
      days_left: comp.days_remaining
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

app.get('/reports/refunds', requireAuth, async (req, res) => {
  const data = await getContext();
  let policies = data.policies.map(p => attachCustomer(p, data));
  
  // Filter by date if provided
  const { start_date, end_date } = req.query;
  if (start_date) {
    policies = policies.filter(p => (p.issue_date || p.start_date) >= start_date);
  }
  if (end_date) {
    policies = policies.filter(p => (p.issue_date || p.start_date) <= end_date);
  }

  // Calculate Stats
  const stats = {
    totalCommission: 0,
    totalRefund: 0,
    netProfit: 0
  };

  policies.forEach(p => {
    const comm = Number(p.commission) || 0;
    const ref = Number(p.commission_refund) || 0;
    stats.totalCommission += comm;
    stats.totalRefund += ref;
  });
  stats.netProfit = stats.totalCommission - stats.totalRefund;

  const qs = new URLSearchParams(req.query).toString();
  res.render('reports/refunds', { 
    title: 'İade Raporu', 
    policies, 
    stats, 
    query: req.query, 
    qs 
  });
});

app.get('/reports/refunds/export.xlsx', requireAuth, async (req, res) => {
  const data = await getContext();
  let policies = data.policies.map(p => attachCustomer(p, data));
  
  const { start_date, end_date } = req.query;
  if (start_date) {
    policies = policies.filter(p => (p.issue_date || p.start_date) >= start_date);
  }
  if (end_date) {
    policies = policies.filter(p => (p.issue_date || p.start_date) <= end_date);
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Iadeler');
  ws.columns = [
    { header: 'Tarih', key: 'date', width: 15 },
    { header: 'Poliçe No', key: 'policy_number', width: 20 },
    { header: 'Müşteri', key: 'customer', width: 25 },
    { header: 'Şirket', key: 'insurer', width: 20 },
    { header: 'Komisyon', key: 'commission', width: 15 },
    { header: 'İade', key: 'refund', width: 15 },
    { header: 'Net', key: 'net', width: 15 }
  ];

  policies.forEach(p => {
    const comm = Number(p.commission) || 0;
    const ref = Number(p.commission_refund) || 0;
    ws.addRow({
      date: p.issue_date || p.start_date,
      policy_number: p.policy_number,
      customer: p.customer_name,
      insurer: p.insurer,
      commission: comm,
      refund: ref,
      net: comm - ref
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="iade_raporu.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

// TEST MAIL ROUTE
app.all('/test-mail', requireAuth, requireAdmin, async (req, res) => {
    // Support both GET (query) and POST (body)
    const targetEmail = req.body.email || req.query.to || req.query.email || req.session.user.username; // Fallback to current user
    
    if (!targetEmail) return res.status(400).send('Email adresi bulunamadı. Lütfen bir hedef adres belirtin.');

    console.log('Test maili isteği alındı:', targetEmail);
    try {
        const result = await sendMail(
            'Test Maili - Sigorta CRM',
            'Bu bir test mailidir. Sisteminiz mail gönderebiliyor.',
            '<h3>Tebrikler!</h3><p>SMTP ayarlarınız doğru yapılandırılmış görünüyor.</p>',
            [],
            targetEmail
        );

        if (result.ok) {
             res.render('test-mail-success', { 
                 title: 'Test Başarılı', 
                 email: targetEmail,
                 info: result.info 
             });
        } else {
             // Enhance error message for timeouts
             let errorMsg = result.error;
             let hint = "";
             
             if (errorMsg.includes('ETIMEDOUT') || errorMsg.includes('Connection timeout')) {
                 hint = `
                 <div class="alert alert-warning mt-3">
                    <strong>Olası Çözüm:</strong><br>
                    Sunucunuz (Render vb.) Port 587'ye erişimi kısıtlıyor olabilir.<br>
                    Lütfen <strong>Ayarlar</strong> sayfasından şunları deneyin:<br>
                    1. <strong>Alternatif Port:</strong> 2525 (Secure: Hayır)<br>
                    2. <strong>Güvenli Port:</strong> 465 (Secure: Evet)<br>
                    <br>
                    <em>Not: Brevo/Sendinblue için Port 2525 genellikle en iyi sonucu verir.</em>
                 </div>`;
             }
             
             res.send(`
                <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #dc3545;">Mail Gönderilemedi</h2>
                    <p><strong>Hata Detayı:</strong> ${errorMsg}</p>
                    <p><strong>Hedef Adres:</strong> ${targetEmail}</p>
                    ${hint}
                    <hr>
                    <a href="/settings" style="display: inline-block; padding: 10px 20px; background: #0d6efd; color: white; text-decoration: none; border-radius: 5px;">Ayarlara Dön</a>
                </div>
             `);
        }
    } catch (error) {
        console.error('Test mail hatası:', error);
        res.status(500).send('Bir hata oluştu: ' + error.message);
    }
});

app.use((req, res) => {
  res.status(404).send('Sayfa bulunamadı');
});
