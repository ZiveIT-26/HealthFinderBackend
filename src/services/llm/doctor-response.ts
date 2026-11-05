import { z } from 'zod';

const httpsUrlSchema = z
  .string()
  .refine(
    (value) => {
      try {
        return new URL(value).protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Must be a valid HTTPS URL' },
  );

export const doctorSchema = z.object({
  name: z.string(),
  speciality: z.string(),
  address: z.string(),
  url: httpsUrlSchema,
  phone: z.string().nullable(),
  email: z.string().nullable(),
  additionalInfo: z.string().nullable(),
});

export const doctorResponseSchema = z.object({
  text: z.string(),
  doctors: z.array(doctorSchema),
});

export type DoctorResponse = z.infer<typeof doctorResponseSchema>;
