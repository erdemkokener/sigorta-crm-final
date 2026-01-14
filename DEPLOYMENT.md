# Sigorta CRM - Profesyonel & Ücretsiz Yayına Alma Rehberi

Bu rehber, uygulamanızı **ömür boyu ücretsiz** ve **profesyonel** bir altyapıyla nasıl yayınlayacağınızı adım adım anlatır.

## Önerilen Teknoloji Yığını (Stack)

En güvenilir, ücretsiz ve profesyonel çözüm şudur:
1.  **Veritabanı:** [MongoDB Atlas](https://www.mongodb.com/atlas/database) (M0 Free Tier)
    *   **Neden?** Verileriniz bulutta güvenle saklanır. Sunucu çökse bile veriler kaybolmaz. 512MB depolama alanı binlerce poliçe için yeterlidir.
2.  **Sunucu:** [Render](https://render.com) (Free Web Service)
    *   **Neden?** Node.js uygulamalarını ücretsiz çalıştırır. SSL (https) sertifikasını otomatik verir.

---

## Adım 1: Kod Altyapısını Hazırlama (Otomatik Yapılıyor)

Uygulamanız şu an verileri `data.json` dosyasında tutuyor. Profesyonel bulut sistemlerinde dosyalar kalıcı değildir. Bu yüzden uygulamanızı **MongoDB** veritabanı ile çalışacak şekilde güncelliyoruz.

**Yapılan Güncellemeler:**
*   `mongoose` paketi yüklendi.
*   Veritabanı bağlantı ayarları eklendi.
*   Uygulama artık hem yerel dosya (test için) hem de MongoDB (canlı için) destekliyor.

## Adım 2: MongoDB Atlas Hesabı Açma

1.  [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) adresine gidip ücretsiz üye olun.
2.  **"Build a Database"** butonuna basın ve **"M0" (Free)** seçeneğini seçin.
3.  Bir kullanıcı adı ve şifre oluşturun (Bu şifreyi bir yere not edin!).
4.  **"Connect"** butonuna basın ve **"Drivers"** seçeneğini seçin.
5.  Size verilen bağlantı linkini kopyalayın. Şuna benzer olacaktır:
    `mongodb+srv://kullanici:sifre@cluster0.mongodb.net/?retryWrites=true&w=majority`
    *(Linkteki `<password>` yerine kendi şifrenizi yazmayı unutmayın)*

### 🆘 Bağlantı Linkini (URI) Kaybetmeniz Durumunda:
Eğer linki kopyalamayı unuttuysanız endişelenmeyin, tekrar alabilirsiniz:
1.  [MongoDB Atlas Paneline](https://cloud.mongodb.com) giriş yapın.
2.  Ana sayfada **"Database"** bölümüne gelin.
3.  Cluster isminizin yanındaki **"Connect"** butonuna basın.
4.  Açılan pencerede **"Drivers"** seçeneğine tıklayın.
5.  **"3. Add your connection string into your application code"** altındaki linki kopyalayın.
6.  **Dikkat:** Linkteki `<password>` yazan yeri silip, veritabanı kullanıcısını oluştururken belirlediğiniz şifreyi yazmayı unutmayın. (Atlas giriş şifreniz değil, veritabanı kullanıcısı şifresi).

### 🌍 Çok Önemli: MongoDB Ağ Erişimi (Network Access)
Eğer Render uygulamanız çalışmazsa veya "bağlanılamadı" hatası alırsanız, büyük ihtimalle MongoDB'nin güvenlik duvarına takılıyordur. Şunu yapmalısınız:
1.  MongoDB Atlas panelinde sol taraftaki menüde **"Security"** başlığını bulun.
2.  Bu başlığın altındaki **"Network Access"** seçeneğine tıklayın.
3.  **"Add IP Address"** butonuna basın.
4.  **"Allow Access From Anywhere"** butonuna tıklayın (veya `0.0.0.0/0` yazın).
5.  **Confirm** diyerek kaydedin.
(Bu işlem bulut sunucunuzun veritabanına erişebilmesi için şarttır).

## Adım 3: GitHub'a Yükleme (Git Bilmeyenler İçin Kolay Yöntem)

Kodları GitHub'a yüklemek için **GitHub Desktop** uygulamasını kullanacağız. Bu yöntem kod yazmayı gerektirmez.

1.  **GitHub Hesabı Açın:** [github.com](https://github.com) adresine gidip ücretsiz üye olun.
2.  **GitHub Desktop İndirin:** [desktop.github.com](https://desktop.github.com) adresinden uygulamayı indirip kurun ve GitHub hesabınızla giriş yapın.
3.  **Projeyi Ekleyin:**
    *   GitHub Desktop uygulamasını açın.
    *   **File** (Dosya) > **Add Local Repository** (Yerel Depo Ekle) menüsüne tıklayın.
    *   **Choose...** butonuna basıp projenizin klasörünü seçin: `c:\Users\PC\Documents\trae_projects\sigorta crm`
    *   "This directory does not appear to be a Git repository" uyarısı çıkarsa **Create a Repository** (Depo Oluştur) linkine tıklayın.
    *   Açılan pencerede **Create Repository** butonuna basın.
4.  **Yayınlayın (Publish):**
    *   Uygulamanın üst kısmındaki **Publish repository** butonuna basın.
    *   İsim olarak `sigorta-crm` yazabilirsiniz.
    *   "Keep this code private" seçeneğini **kaldırırsanız** (herkes görebilir) Render.com ücretsiz sürümüyle daha kolay çalışır. (Özel proje seçerseniz Render'a kredi kartı tanımlamanız gerekebilir).
    *   **Publish Repository** butonuna basarak yüklemeyi tamamlayın.

## Adım 4: Render.com'da Yayınlama

1.  [Render.com](https://render.com) adresine üye olun (GitHub ile giriş yapabilirsiniz).
2.  **"New + "** butonuna basıp **"Web Service"** seçin.
3.  Listede `sigorta-crm` projenizi göreceksiniz. Yanındaki **Connect** butonuna basın.
4.  Açılan sayfada bir süre aşağı kaydırın (En alttaki mavi butona basmadan önce).
5.  **"Environment Variables"** (veya bazen "Advanced" altında olabilir) başlığını arayın.
6.  **"Add Environment Variable"** butonuna tıklayarak şu bilgileri girin:
    *   **Variable 1:**
        *   Key: `MONGODB_URI`
        *   Value: *(MongoDB'den aldığınız bağlantı linki - şifrenizi içine yazdığınızdan emin olun)*
    *   **Variable 2:**
        *   Key: `SSION_SECRET`
        *   Value: `gizli-sifrem-123` *(veya rastgele bir kelime)*
7.  En alttaki **"Create Web Service"** butonuna basın.

> **Not:** Eğer servisiES çoktan oluşturduysanız ve bu alanı kaçırdıysanız sorun değil:
> 1. Render Dashboard'da uygulamanıza tıklayın.
> 2. Sol menüden **"Environment"** sekmesine tıklayın.
> 3. Buradan "Add Environment Variable" diyerek ekleyebilirsiniz.

Tebrikler! Artık uygulamanız `https://sigorta-crm.onrender.com` adresinde, profesyonel bir veritabanı ile 7/24 çalışıyor.
