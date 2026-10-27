// Fetching the build's JSON output.
/** A project page's data directory, relative to the page. */ const D = '../data/';
/** The JSON at `path`, typed as the build writes it; throws on an HTTP error. */ export const get = (path)=>fetch(path).then((r)=>{
        if (!r.ok) throw new Error(`${path}: ${r.status}`);
        return r.json();
    });
export async function loadProject(id, changelog) {
    const [projects, annotations, summary, daily, weekly, releases] = await Promise.all([
        get(`${D}projects.json`),
        get(`${D}annotations.json`),
        get(`${D}${id}/summary.json`),
        get(`${D}${id}/daily.json`),
        get(`${D}${id}/weekly.json`),
        changelog ? get(`${D}${id}/releases.json`) : []
    ]);
    return {
        projects,
        annotations,
        summary,
        daily,
        weekly,
        releases
    };
}
/** One month's events of project `id`; `month` is `YYYY-MM`. */ export const loadMonth = (id, month)=>get(`${D}${id}/months/${month}.json`);
//# sourceMappingURL=data.js.map
