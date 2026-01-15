$env:APP_USER="admin"
$env:APP_PASS="admin123"
$env:SESSION_SECRET="secret123"
$env:MAIL_MODE="smtp"
$env:SMTP_HOST="smtp.gmail.com"
$env:SMTP_PORT="587"
$env:SMTP_SECURE="false"
$env:SMTP_USER="erdemkokener@gmail.com"
$env:SMTP_PASS="bznfvszqqhasczon"
$env:MAIL_FROM="erdemkokener@gmail.com"
$env:MAIL_TO="erdemkokener@gmail.com"
$env:DATA_FILE="C:\Users\PC\OneDrive\Belgeler\sigortacrmfinal\local-data.json"
# MongoDB Bağlantısı (İsteğe bağlı - Yerelde bulut veritabanını kullanmak için)
# $env:MONGODB_URI="mongodb+srv://erdemkokener:<db_password>@cluster0.wsaqpek.mongodb.net/?appName=Cluster0"
$env:EMERGENCY_RESET_CODE="erdemAcil2025!"
$env:ALLOW_RESET="false"
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH
 
# Start the application
npm start
