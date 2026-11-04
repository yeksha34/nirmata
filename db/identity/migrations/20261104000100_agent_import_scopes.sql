-- Agent tokens may also import (F-74, ADR-0037). An import is not an adaptation: it fills a world with
-- its cards, story and guidance, so it has its own two verbs. A token made before this keeps the two
-- adaptation scopes it had; an author makes a new one to let an agent import.

alter table identity.agent_tokens drop constraint agent_tokens_scopes_check;
alter table identity.agent_tokens add constraint agent_tokens_scopes_check check (
  scopes <> '{}'
  and scopes <@ array['adaptation.read', 'adaptation.write', 'import.read', 'import.write']
);
