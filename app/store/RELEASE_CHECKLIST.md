# Публикация InvoTaxi

Проект технически подготовлен для Google Play и App Store. Перед загрузкой владелец продукта должен подтвердить юридические реквизиты, домен и учётные записи магазинов.

## Обязательные значения

- production API только по HTTPS, например `https://api.example.kz/api/v1`;
- публичные URL: `/privacy`, `/terms`, `/account-deletion`, `/support`;
- рабочий email поддержки (сейчас шаблон: `support@invotaxi.kz`);
- юридическое имя оператора, адрес и контакты для карточек магазинов;
- уникальные `applicationId` / Bundle ID (сейчас `com.invotaxi.invotaxi`);
- финальные название, описание, категория, возрастной рейтинг, иконка и скриншоты.

## Android / Google Play

1. Новые приложения и обновления должны иметь target API 35 или выше: проект принудительно использует минимум 35.
2. Новые приложения публикуются в формате Android App Bundle (`.aab`).
3. Создать upload key вне репозитория и скопировать `android/key.properties.example` в `android/key.properties`.
4. Собрать:
   `flutter build appbundle --release --dart-define=API_BASE_URL=https://API_HOST/api/v1 --dart-define=ALLOW_DEV_LOGIN=false`
5. В Play Console заполнить Data safety по `DATA_SAFETY.md`, указать HTTPS URL политики и URL удаления аккаунта.
6. Проверить internal testing, pre-launch report, разрешение точной геопозиции и удаление аккаунта.

Официальные требования:
- https://developer.android.com/google/play/requirements/target-sdk
- https://developer.android.com/guide/app-bundle
- https://support.google.com/googleplay/android-developer/answer/10787469
- https://support.google.com/googleplay/android-developer/answer/13327111

## iOS / App Store

1. На macOS открыть `ios/Runner.xcworkspace`, выбрать команду и Apple Distribution signing.
2. Проверить Bundle ID, версию/build number, deployment target и `PrivacyInfo.xcprivacy`.
3. Собрать:
   `flutter build ipa --release --dart-define=API_BASE_URL=https://API_HOST/api/v1 --dart-define=ALLOW_DEV_LOGIN=false`
4. В App Store Connect указать Privacy Policy URL, заполнить App Privacy и дать reviewer тестовый номер/роль/PIN.
5. Проверить удаление аккаунта внутри приложения, описание использования геопозиции и отсутствие HTTP.

Официальные требования:
- https://developer.apple.com/app-store/review/guidelines/
- https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy
- https://developer.apple.com/support/offering-account-deletion-in-your-app
- https://developer.apple.com/documentation/bundleresources/privacy-manifest-files

## Блокеры, которые нельзя создать кодом

- Apple Developer / Google Play Developer аккаунты;
- Apple certificates/provisioning profiles и Android upload key;
- подтверждённый HTTPS-домен;
- настоящие реквизиты оператора и рабочий email;
- store screenshots и окончательный review account.
