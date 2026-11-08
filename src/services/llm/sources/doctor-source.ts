/**
 * One website (or API) that lists doctors. Every site gets its own adapter that
 * implements this interface, so adapters are interchangeable: find_doctors does
 * not know which site it talks to.
 *
 * Adapters are listed in sources/index.ts. find_doctors asks all of them at the
 * same time and combines their doctors (duplicates removed, first source first).
 *
 * Speciality names: the model picks from the names of all sources together
 * (findSpecialities). Sources should use the same Slovak names (e.g. "Neurológ"),
 * or map their own names to them inside the adapter, so one speciality is not
 * listed twice under different names.
 */
// ill better leave this comment here
export interface DoctorSource {
  readonly name: string;

  getSpecialities(): Promise<Speciality[]>;
  getTowns(speciality: Speciality): Promise<Town[]>;
  getDoctors(speciality: Speciality, town: Town): Promise<DoctorListing[]>;
}

export type Speciality = {
  name: string;
  id: string;
  count: number;
};

export type Town = {
  name: string;
  id: string;
  url: string;
  count: number;
};

export type DoctorListing = {
  name: string;
  specialities: string[];
  address: string;
  url: string;
  /** Optional extra line for the user, e.g. opening hours and insurers. */
  details?: string;
};
