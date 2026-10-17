// `/sms-opt-in`: how a guest asks for a text, for a carrier review. The words live in
// ../legal-content.js, shared with the static copy in dist/.
import LegalPage from '../components/LegalPage.jsx';
import { SMS_OPT_IN } from '../legal-content.js';

export default function SmsOptIn() {
  return <LegalPage page={SMS_OPT_IN} />;
}
