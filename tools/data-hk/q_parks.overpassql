[out:json][timeout:120];
(
  way["leisure"~"^(park|garden)$"]["name"](22.273,114.145,22.300,114.180);
  relation["leisure"~"^(park|garden)$"]["name"](22.273,114.145,22.300,114.180);
  way["landuse"="grass"]["name"](22.273,114.145,22.300,114.180);
);
out geom;
