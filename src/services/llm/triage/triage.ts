import { z } from 'zod';
import { findRedFlags } from './red-flags.js';

// replaces "isEmergency + confidence >= 0.7"
export type TriageLevel = 0 | 1 | 2 | 3;

export const TRIAGE_LEVEL_NAMES: Record<TriageLevel, string> = {
  0: 'self-care', // no doctor needed (advice, prevention, small talk)
  1: 'routine', // see a doctor in the next couple days
  2: 'urgent', // see a doctor today (emergency department)
  3: 'emergency', // call ambulance now
};


export const triageModelSchema = z.object({
  hasSymptoms: z.boolean(),
  reasons: z.array(z.string()),
  level: z.number().int().min(0).max(3),
});

export type TriageModelResult = z.infer<typeof triageModelSchema>;

export type TriageResult = {
  level: TriageLevel;
  modelLevel: TriageLevel | null; // model guessed level
  hasSymptoms: boolean | null;
  redFlags: string[];
  reasons: string[];
};

export function combineTriage(
  latestUserMessage: string,
  model: TriageModelResult | null,
): TriageResult {
  const redFlags = findRedFlags(latestUserMessage);
  const modelLevel = model ? clampLevel(model.level) : null;
  const symptomLevel: TriageLevel = model?.hasSymptoms ? 1 : 0;
  const ruleLevel: TriageLevel = redFlags.length > 0 ? 3 : 0;

  const reasons = [...(model?.reasons ?? [])];
  if (model?.hasSymptoms && (modelLevel ?? 0) < 1) reasons.push('has symptoms: at least routine');
  if (redFlags.length > 0) reasons.push(`red flags: ${redFlags.join(', ')}`);
  if (modelLevel === null) reasons.push('model triage failed; rules only');

  return {
    level: Math.max(modelLevel ?? 0, symptomLevel, ruleLevel) as TriageLevel,
    modelLevel,
    hasSymptoms: model ? model.hasSymptoms : null,
    redFlags,
    reasons,
  };
}

function clampLevel(value: number): TriageLevel {
  return Math.min(3, Math.max(0, Math.round(value))) as TriageLevel;
}
