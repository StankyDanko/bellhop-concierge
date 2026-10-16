// `/terms` (and `/sms-terms`). The words live in ../legal-content.js, shared with the static
// copy in dist/.
import LegalPage from '../components/LegalPage.jsx';
import { TERMS } from '../legal-content.js';

export default function Terms() {
  return <LegalPage page={TERMS} />;
}
