export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  employmentType: string;
  category: string;
  salary?: string;
  description: string;
  requirements: string[];
  match: number;
}