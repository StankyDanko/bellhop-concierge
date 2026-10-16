// `/privacy`. The words live in ../legal-content.js, shared with the static copy in dist/.
import LegalPage from '../components/LegalPage.jsx';
import { PRIVACY } from '../legal-content.js';

export default function Privacy() {
  return <LegalPage page={PRIVACY} />;
}
