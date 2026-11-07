import { z } from 'zod';

// `url` is a plain string here on purpose: a `.refine()` check is not part of the
// JSON schema sent to the model, and one bad URL would fail the whole answer.
// Invalid URLs are filtered out in the `finalize` node instead.
export const doctorSchema = z.object({
  name: z.string(),
  speciality: z.string(),
  address: z.string(),
  url: z.string().describe('HTTPS URL of the page the doctor was found on'),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  additionalInfo: z.string().nullable(),
});

export const doctorResponseSchema = z.object({
  text: z.string(),
  doctors: z.array(doctorSchema),
});

export type DoctorResponse = z.infer<typeof doctorResponseSchema>;
