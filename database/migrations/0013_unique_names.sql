-- Name uniqueness, case-insensitive (lower(name), matching the
-- material_catalog index from 0010): two "Smith Deck" projects -- or
-- "smith deck" -- are duplicates in spirit, and duplicate names make
-- search results, estimate project pickers, and the estimates list
-- ambiguous. The create actions catch the unique violation and return a
-- friendly message.

-- Projects: unique per company.
create unique index projects_company_id_lower_name_key
  on projects (company_id, lower(name));

-- Estimates: unique per project. NULLS NOT DISTINCT (PG15+) so
-- standalone estimates (project_id is null -- see 0011) form their own
-- uniqueness group within the company instead of being exempt: two
-- standalone "Deck Bid" estimates would be exactly the ambiguity this
-- exists to prevent, since the /estimates list is their only home.
-- company_id leads the index so linked and standalone estimates are
-- both scoped to the company that owns them.
create unique index estimates_company_project_lower_name_key
  on estimates (company_id, project_id, lower(name)) nulls not distinct;
