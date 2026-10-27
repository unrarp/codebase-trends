// Calendar arithmetic on ISO dates (`YYYY-MM-DD`, UTC). Weeks start Monday 00:00 UTC.
export const DAY = 86_400_000;
export const WEEK = 7 * DAY;
export const dayOf = (t)=>new Date(t).toISOString().slice(0, 10);
export const mondayOf = (d)=>{
    const t = Date.parse(`${d}T00:00:00Z`);
    return dayOf(t - (new Date(t).getUTCDay() + 6) % 7 * DAY);
};
export const weekEnd = (d)=>dayOf(Date.parse(`${d}T00:00:00Z`) + 6 * DAY);
//# sourceMappingURL=time.js.map
