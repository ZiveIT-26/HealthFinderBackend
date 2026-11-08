/**
 * One website (or API) that lists doctors. Every site gets its own adapter that
 * implements this interface, so adapters are interchangeable: find_doctors does
 * not know which site it talks to.
 *
 * Adapters are listed in sources/index.ts and tried one by one, in that order,
 * until one of them returns doctors.
 *
 * Speciality names: the FIRST source defines the official list (the model picks
 * from it). Other sources should return the same Slovak names, or map their own
 * names to them inside the adapter.
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
};
