# References

Every DOI below was resolved via doi.org / Crossref on 2026-09-29. Items are grouped by how the prototype uses them.

## A. Datasets used (REAL public data)

| Layer | Reference | Access used |
|---|---|---|
| Elevation | Farr, T. G., et al. (2007). The Shuttle Radar Topography Mission. *Reviews of Geophysics*, 45, RG2004. https://doi.org/10.1029/2005RG000183 | SRTM 1-arcsec HGT via AWS Terrain Tiles (`skadi`), https://registry.opendata.aws/terrain-tiles/ |
| Land cover / imperviousness proxy | Zanaga, D., et al. (2022). *ESA WorldCover 10 m 2021 v200* [Dataset]. Zenodo. https://doi.org/10.5281/zenodo.7254221 | Cloud-optimised GeoTIFF, https://registry.opendata.aws/esa-worldcover-vito/ |
| Rainfall (spatial pattern) | Funk, C., et al. (2015). The climate hazards infrared precipitation with stations — a new environmental record for monitoring extremes. *Scientific Data*, 2, 150066. https://doi.org/10.1038/sdata.2015.66 | CHIRPS-2.0 global monthly GeoTIFFs, July 2019–2023: https://data.chc.ucsb.edu/products/CHIRPS-2.0/global_monthly/tifs/ |
| Rainfall (hourly forecast, optional live mode) | Zippenfenig, P. (2024). *Open-Meteo.com Weather API* (v1.4.0) [Software]. Zenodo. https://doi.org/10.5281/zenodo.7970649 | https://open-meteo.com/ (NWP model output, not gauge observation) |
| Roads, waterways | OpenStreetMap contributors. Data © OpenStreetMap contributors, ODbL 1.0. https://www.openstreetmap.org/copyright | Overpass API |
| Historical flooding spots (Mumbai) | "Chronic Flooding Spots and 1926 Map of Bombay Suburbs", web map by Abhijit Ekbote, https://cityresource.in/MumbaiFloods/ | Layer `data/exp_ChronicFloodingSpots.js` (55 buffered points). Community-digitised; original compilation source not stated on the page. |

Considered, not used in the prototype build:
- Huffman, G. J., Stocker, E. F., Bolvin, D. T., Nelkin, E. J., & Tan, J. (2023). *GPM IMERG Final Precipitation L3 Half Hourly 0.1° × 0.1° V07* [Dataset]. NASA GES DISC. https://doi.org/10.5067/GPM/IMERG/3B-HH/07. This is the natural sub-daily observed forcing, but it needs an Earthdata login.
- Pekel, J.-F., Cottam, A., Gorelick, N., & Belward, A. S. (2016). High-resolution mapping of global surface water and its long-term changes. *Nature*, 540, 418–422. https://doi.org/10.1038/nature20584

## B. Mumbai drainage context (basis for REPRESENTATIVE drainage parameters)

- Municipal Corporation of Greater Mumbai, "6. Storm Water Drainage" (development-plan chapter on the Mumbai SWD system and BRIMSTOWAD), hosted by MoEFCC PARIVESH: https://forestsclearance.nic.in/writereaddata/Addinfo/0_0_1112123912121BRIMSTOWADreportonStormWaterDrainage.pdf
  - Used for: "The old SWD system is capable of handling rain intensity of 25 mm per hour at low tide"; 186 outfalls, of which 136 go to the Arabian Sea; tidal effect as a major cause of flooding; named flood-prone locations (Table 26).
  - The prototype uses these as design **parameters** for a representative network. It does **not** reproduce MCGM's network.
- Gupta, K. (2007). Urban flood resilience planning and management and lessons for the future: a case study of Mumbai, India. *Urban Water Journal*, 4(3), 183–194. https://doi.org/10.1080/15730620701464141

## C. Mumbai flood mapping and susceptibility (basis for conditioning factors)

- Pawar, A. S., & Phade, G. M. (2026). Hydrologically Enhanced Machine Learning Framework for Urban Flood Inundation Mapping Using Multi-Sensor Remote Sensing Data: A Case Study of Mumbai, India. *EGUsphere* (preprint under review). https://doi.org/10.5194/egusphere-2026-1275
  - Uses Sentinel-1, Sentinel-2, SRTM, CHIRPS and HydroRIVERS, plus a relative-elevation (HAND-type) predictor.
  - Note: the open reviews raise label leakage and the lack of independent validation. The prototype cites it only for its choice of inputs.
- Manna, H., Das, M., Pramanik, M., Sarkar, S., Mahato, S., Talukdar, S., Alkhuraiji, W. S., & Zhran, M. (2025). Ensemble intelligence for urban resilience: flood susceptibility modeling in Mumbai using advanced machine learning. *Geomatics, Natural Hazards and Risk*, 16(1). https://doi.org/10.1080/19475705.2025.2588718
  - Conditioning factors: elevation, aspect, slope, precipitation, distance to roads, coast and blue spaces, building density, LULC. Elevation was reported as the most important.
- Solanki, Y. P., Kumar, V., Sharma, K. V., Deshmukh, A., & Tiwari, D. K. (2024). Flood hazard analysis in Mumbai using geospatial and multi-criteria decision-making techniques. *Journal of Water and Climate Change*, 15(5), 2484–2500. https://doi.org/10.2166/wcc.2024.053
- Zope, P. E., Eldho, T. I., & Jothiprakash, V. (2016). Impacts of land use–land cover change and urbanization on flooding: A case study of Oshiwara River Basin in Mumbai, India. *CATENA*, 145, 142–154. https://doi.org/10.1016/j.catena.2016.06.009

## D. Urban flood nowcasting and drainage–surface coupling

- Henonin, J., Russo, B., Mark, O., & Gourbesville, P. (2013). Real-time urban flood forecasting and modelling — a state of the art. *Journal of Hydroinformatics*, 15(3), 717–736. https://doi.org/10.2166/hydro.2013.132
- Leandro, J., Chen, A. S., Djordjević, S., & Savić, D. A. (2009). Comparison of 1D/1D and 1D/2D coupled (sewer/surface) hydraulic models for urban flood simulation. *Journal of Hydraulic Engineering*, 135(6), 495–504. https://doi.org/10.1061/(ASCE)HY.1943-7900.0000037
- Guo, Z., Leitão, J. P., Simões, N. E., & Moosavi, V. (2021). Data-driven flood emulation: Speeding up urban flood predictions by deep convolutional neural networks. *Journal of Flood Risk Management*, 14(1), e12684. https://doi.org/10.1111/jfr3.12684. Related work only; the prototype does not use deep learning.

## E. Methods

- Runoff: USDA NRCS (2004). *National Engineering Handbook, Part 630 Hydrology, Chapter 9: Hydrologic Soil-Cover Complexes* (Curve Number tables). https://directives.nrcs.usda.gov/sites/default/files2/1712930607/7306.pdf. The Curve Number values follow the TR-55 (USDA SCS, 1986, *Urban Hydrology for Small Watersheds*) cover categories, and are used for the WorldCover class → CN mapping with an assumed soil group D.
- Conduit capacity: Manning's equation for full-pipe flow; see Chow, V. T. (1959). *Open-Channel Hydraulics*. McGraw-Hill.
- Surcharge/overflow concept: US EPA Storm Water Management Model (SWMM), https://www.epa.gov/water-research/storm-water-management-model-swmm
- Relative elevation (HAND-type) depression proxy: Rennó, C. D., et al. (2008). HAND, a new terrain descriptor using SRTM-DEM. *Remote Sensing of Environment*, 112(9), 3469–3481. https://doi.org/10.1016/j.rse.2008.03.018
