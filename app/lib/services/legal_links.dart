import 'package:url_launcher/url_launcher.dart';

const privacyUrl = 'https://invotaxi.kz/privacy';
const termsUrl = 'https://invotaxi.kz/terms';

Future<void> openLegalUrl(String value) {
  return launchUrl(Uri.parse(value), mode: LaunchMode.externalApplication);
}
