-- Importing a spreadsheet can overwrite rows that match ones already there
-- ("Overwrite duplicates" in the Data tab), so the app may update a row's data.
grant update (data) on site_table_rows to zsite_app;
