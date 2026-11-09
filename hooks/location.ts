// The place the tab is set for (Walton, KY built in). register.tsx swaps it with setLoc when a location file is in use; everything else reads LOC here.

import type { Loc } from './types'

export let LOC: Loc = {
  name: 'Walton, KY',
  short: 'Walton',
  wxStation: 'KIH42',
  wxCity: 'Covington',
  wxFreq: 162.55,
  riverName: 'Ohio River',
  repeaters: [
    { mhz: 146.88, name: 'Cincinnati SKYWARN repeater', short: 'SKYWARN', mark: true, wx: true },
    { mhz: 146.79, name: 'NKARC net repeater', short: 'NKARC' },
    { mhz: 147.03, name: 'K4CO Edgewood repeater', short: 'K4CO' },
    { mhz: 147.255, name: 'K4CO Edgewood repeater', short: 'K4CO' },
  ],
  error: null,
}

// Assigned only here: other modules read LOC through the live import.
export function setLoc(next: Loc): void {
  LOC = next
}
