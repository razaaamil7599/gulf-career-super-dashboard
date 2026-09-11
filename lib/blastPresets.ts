export const VACANCY_BLAST_MESSAGE =
  'Assalam-o-Alaikum {name},\n\nGulf Career Gateway mein aap ka swagat hai.\n\nHumare paas {skill} ki nayi vacancy aayi hai {country} ke liye.\n\nKya aap interested hain? Agar haan, to foran reply karein.\n\nGulf Career Gateway';

export const REPROFILE_BLAST_MESSAGE =
  'Assalam-o-Alaikum {name},\n\nGulf Career Gateway aapki job profile dobara update kar raha hai.\n\nReply mein apna current skill, preferred country, total experience, current location, passport status aur updated CV share karein.\n\nAap WhatsApp par hi details bhej sakte hain. Final shortlist employer selection aur documents par depend karegi.\n\nGulf Career Gateway';

export const REPROFILE_OFFICIAL_TEMPLATE = 'gcg_reprofile_marketing_plain_hi_apr03';

export const BLAST_PRESETS = [
  {
    id: 'vacancy',
    label: 'Vacancy',
    description: 'General vacancy update ya broadcast ke liye.',
    message: VACANCY_BLAST_MESSAGE,
    recommendedTemplate: '',
  },
  {
    id: 'reprofile',
    label: 'Re-Profile',
    description: 'Pending re-profile candidates se updated details mangne ke liye.',
    message: REPROFILE_BLAST_MESSAGE,
    recommendedTemplate: REPROFILE_OFFICIAL_TEMPLATE,
  },
] as const;

export type BlastPresetId = (typeof BLAST_PRESETS)[number]['id'];
