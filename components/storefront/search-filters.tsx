import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { SearchQuery } from "@/lib/search";

export type LocationOptions = { states: { id: number; name: string }[]; lgas: { id: number; name: string }[] };

/**
 * Plain GET form: works without JavaScript and every filter combination has a
 * shareable URL. Choosing a state and pressing Apply loads its LGAs.
 */
export function SearchFilters({
  action,
  query,
  locations,
  showStock,
  showPrice = true,
}: {
  action: string;
  query: SearchQuery;
  locations: LocationOptions;
  showStock: boolean;
  showPrice?: boolean;
}) {
  const naira = (k?: bigint) => (k === undefined ? "" : String(Number(k) / 100));
  return (
    <form action={action} className="flex flex-col gap-5" aria-label="Filters">
      {query.q && <input type="hidden" name="q" value={query.q} />}
      {query.kind !== "all" && <input type="hidden" name="kind" value={query.kind} />}
      <div className="flex flex-col gap-2">
        <Label htmlFor="f-sort">Sort by</Label>
        <Select id="f-sort" name="sort" defaultValue={query.sort}>
          <option value="relevance">{query.q ? "Best match" : "Popular"}</option>
          <option value="newest">Newest</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
          <option value="rating">Rating</option>
        </Select>
      </div>
      {showPrice && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Price (₦)</legend>
          <div className="flex items-center gap-2">
            <Input name="min" inputMode="numeric" aria-label="Minimum price" placeholder="Min" defaultValue={naira(query.minPriceKobo)} className="h-9" />
            <span aria-hidden>–</span>
            <Input name="max" inputMode="numeric" aria-label="Maximum price" placeholder="Max" defaultValue={naira(query.maxPriceKobo)} className="h-9" />
          </div>
        </fieldset>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="f-rating">Rating</Label>
        <Select id="f-rating" name="rating" defaultValue={query.minRating ? String(query.minRating) : ""}>
          <option value="">Any</option>
          <option value="4">4 stars and up</option>
          <option value="3">3 stars and up</option>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="f-state">State</Label>
        <Select id="f-state" name="state" defaultValue={query.stateId ? String(query.stateId) : ""}>
          <option value="">All of Nigeria</option>
          {locations.states.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>
      {locations.lgas.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="f-lga">LGA</Label>
          <Select id="f-lga" name="lga" defaultValue={query.lgaId ? String(query.lgaId) : ""}>
            <option value="">All LGAs</option>
            {locations.lgas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      {showStock && <Checkbox id="f-instock" name="instock" value="1" label="In stock only" defaultChecked={query.inStock} />}
      <Button type="submit" variant="outline">
        Apply filters
      </Button>
    </form>
  );
}
