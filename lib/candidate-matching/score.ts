type MatchingJob = { requiredSkills: string; preferredSkills: string; minimumExperience: number; title: string };
type MatchingCandidate = { resumeText: string; headline: string; currentPosition: string; yearsOfExperience: number };

const splitSkills = (value: string) => value.split(/[,;\n|]/).map((skill) => skill.trim()).filter(Boolean);
const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9+#.\s-]/g, " ");

export function scoreCandidate(job: MatchingJob, candidate: MatchingCandidate) {
  const haystack = normalize([candidate.resumeText, candidate.headline, candidate.currentPosition].join(" "));
  const required = splitSkills(job.requiredSkills);
  const preferred = splitSkills(job.preferredSkills);
  const matchingRequired = required.filter((skill) => haystack.includes(normalize(skill)));
  const missingRequired = required.filter((skill) => !haystack.includes(normalize(skill)));
  const matchingPreferred = preferred.filter((skill) => haystack.includes(normalize(skill)));
  const requiredScore = required.length ? (matchingRequired.length / required.length) * 60 : 60;
  const preferredScore = preferred.length ? (matchingPreferred.length / preferred.length) * 20 : 20;
  const experienceScore = job.minimumExperience <= 0 ? 20 : Math.min(candidate.yearsOfExperience / job.minimumExperience, 1) * 20;
  const score = Math.round(Math.max(0, Math.min(100, requiredScore + preferredScore + experienceScore)));
  const strengths = [
    matchingRequired.length ? `Matches ${matchingRequired.length} required skill${matchingRequired.length === 1 ? "" : "s"}` : "",
    candidate.yearsOfExperience >= job.minimumExperience ? "Meets the stated experience requirement" : "",
    matchingPreferred.length ? `Adds ${matchingPreferred.length} preferred skill${matchingPreferred.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  const concerns = [
    missingRequired.length ? `${missingRequired.length} required skill${missingRequired.length === 1 ? " is" : "s are"} not evidenced` : "",
    candidate.yearsOfExperience < job.minimumExperience ? `Experience is below the requested ${job.minimumExperience} years` : "",
  ].filter(Boolean);
  return {
    score,
    matchingSkills: [...matchingRequired, ...matchingPreferred],
    missingSkills: missingRequired,
    strengths,
    concerns,
    summary: `${score}% match for ${job.title}, based on evidenced skills and stated experience.`,
  };
}
