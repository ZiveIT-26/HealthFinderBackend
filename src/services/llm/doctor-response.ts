import { z } from 'zod';


export const doctorSchema = z.object({
  name: z.string(),
  speciality: z.string(),
  address: z.string(),
  url: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  additionalInfo: z.string().nullable(),
});

export const doctorResponseSchema = z.object({
  text: z.string(),
  doctors: z.array(doctorSchema),
});

export function doctorResponseSchemaForModel(texts: { urlField: string }) {
  return doctorResponseSchema.extend({
    doctors: z.array(doctorSchema.extend({ url: z.string().describe(texts.urlField) })),
  });
}

export type DoctorResponse = z.infer<typeof doctorResponseSchema>;
