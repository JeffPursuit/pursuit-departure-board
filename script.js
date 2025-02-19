//-----------------------------------------------------
// 1) GLOBAL CONFIG
//-----------------------------------------------------

// Your OpenWeatherMap Key
const OWM_API_KEY = '1039fb6709065c24003fc3f28b6efd1f';

// Coordinates for Pursuit’s office
const lat = 40.73061;
const lon = -73.935242;

// Walk times per station (in minutes) for each walking speed
const walkTimes = {
  "hunters-point": { slow: 12, average: 9, fast: 6 },
  "court-square": { slow: 21, average: 16, fast: 11 },
  "21st-street": { slow: 17, average: 13, fast: 9 },
  "queensboro-plaza": { slow: 26, average: 20, fast: 14 }
};

// Mapping station keys to display names
const stationNames = {
  "hunters-point": "Hunters Point",
  "court-square": "Court Square",
  "21st-street": "21st Street",
  "queensboro-plaza": "Queensboro Plaza"
};

/**
 * MTA Lines Config with multiple feeds for trip updates.
 */
const MTA_LINES_CONFIG = [
  // HUNTERS POINT (7)
  {
    stationKey: "hunters-point",
    feedUrl: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
    stationId: "720",
    lines: ["7"]
  },
  // COURT SQUARE (E)
  {
    stationKey: "court-square",
    feedUrl: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace",
    stationId: "F09",
    lines: ["E"]
  },
  // COURT SQUARE (M) – We'll treat "M" as "F" for ordering and display.
  {
    stationKey: "court-square",
    feedUrl: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm",
    stationId: "F09",
    lines: ["M"]
  },
  // COURT SQUARE (G)
  {
    stationKey: "court-square",
    feedUrl: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g",
    stationId: "G22",
    lines: ["G22"]
  },
  // COURT SQUARE (7)
  {
    stationKey: "court-square",
    feedUrl: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
    stationId: "719",
    lines: ["7"]
  },
  // 21ST STREET (G)
  {
    stationKey: "21st-street",
    feedUrl: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g",
    stationId: "G24",
    lines: ["G"]
  },
  // QUEENSBORO PLAZA (N, W)
  {
    stationKey: "queensboro-plaza",
    feedUrl: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw",
    stationId: "R09",
    lines: ["N", "W"]
  },
  // QUEENSBORO PLAZA (7)
  {
    stationKey: "queensboro-plaza",
    feedUrl: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
    stationId: "718",
    lines: ["7"]
  }
];

// Helper: Normalize route IDs (e.g., treat "7X" as "7")
function normalizeRouteId(routeId) {
  return routeId === "7X" ? "7" : routeId;
}

// We'll store the loaded proto type here
let FeedMessage = null;

// Data container for trip updates
const arrivals = {};

//-----------------------------------------------------
// 2) WEATHER LOGIC
//-----------------------------------------------------

let weatherData = null;

function fetchWeatherData() {
  console.log("Fetching weather data...");
  const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&appid=${OWM_API_KEY}&units=imperial&exclude=minutely,daily,alerts`;
  fetch(url)
    .then(response => {
      if (!response.ok) {
        throw new Error("HTTP error, status = " + response.status);
      }
      return response.json();
    })
    .then(data => {
      console.log("Weather data fetched successfully:", data);
      weatherData = data;
      updateCurrentWeather();
      updateForecastWeather();
    })
    .catch(error => {
      console.error("Error fetching weather data:", error);
    });
}

function updateCurrentWeather() {
  if (!weatherData) return;
  const current = weatherData.current;
  document.getElementById("temp").innerHTML = `${Math.round(current.temp)} °F`;
  document.getElementById("wind").innerHTML = `${Math.round(current.wind_speed)} mph`;
  const iconCode = current.weather[0].icon;
  const iconUrl = `https://openweathermap.org/img/wn/${iconCode}@2x.png`;
  document.getElementById("weather-icon").innerHTML = `<img src="${iconUrl}" alt="${current.weather[0].description}" />`;
}

function updateForecastWeather() {
  if (!weatherData) return;
  const selectedTime = document.getElementById("forecast-time").value;
  const now = new Date();
  // Create a target time on the current day using the selected time
  let targetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [hours, minutes] = selectedTime.split(":");
  targetTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
  // Always use the selected time on the same day, even if in the past.
  let closestForecast = weatherData.hourly[0];
  let minDiff = Math.abs((closestForecast.dt * 1000) - targetTime.getTime());
  for (let forecast of weatherData.hourly) {
    const forecastTime = forecast.dt * 1000;
    const diff = Math.abs(forecastTime - targetTime.getTime());
    if (diff < minDiff) {
      minDiff = diff;
      closestForecast = forecast;
    }
  }
  document.getElementById("forecast-temp").innerHTML = `${Math.round(closestForecast.temp)} °F`;
  document.getElementById("forecast-wind").innerHTML = `${Math.round(closestForecast.wind_speed)} mph`;
  const forecastIconCode = closestForecast.weather[0].icon;
  const forecastIconUrl = `https://openweathermap.org/img/wn/${forecastIconCode}@2x.png`;
  document.getElementById("forecast-weather-icon").innerHTML = `<img src="${forecastIconUrl}" alt="${closestForecast.weather[0].description}" />`;
}

// Make sure to update the forecast when the user changes the time.
document.getElementById("forecast-time").addEventListener("change", updateForecastWeather);


//-----------------------------------------------------
// 3) MTA GTFS-RT LOGIC (Trip Updates)
//-----------------------------------------------------

function loadProto(callback) {
  if (FeedMessage) {
    callback();
  } else {
    protobuf.load(["gtfs-realtime.proto", "nyct-subway.proto"], function(err, root) {
      if (err) {
        console.error("Error loading proto files:", err);
        return;
      }
      FeedMessage = root.lookupType("transit_realtime.FeedMessage");
      console.log("Proto files loaded successfully.");
      callback();
    });
  }
}

function fetchMTAData() {
  console.log("Fetching MTA trip update data...");
  MTA_LINES_CONFIG.forEach(cfg => {
    if (!arrivals[cfg.stationKey]) {
      arrivals[cfg.stationKey] = { manhattan: [], queens: [] };
    } else {
      arrivals[cfg.stationKey].manhattan = [];
      arrivals[cfg.stationKey].queens = [];
    }
  });
  MTA_LINES_CONFIG.forEach(cfg => {
    fetch(cfg.feedUrl)
      .then(res => {
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.arrayBuffer();
      })
      .then(buffer => {
        loadProto(() => processFeed(buffer, cfg));
      })
      .catch(err => {
        console.error(`Error fetching MTA trip update feed for ${cfg.stationKey}:`, err);
      });
  });
}

function processFeed(buffer, cfg) {
  const feed = FeedMessage.decode(new Uint8Array(buffer));
  processTripUpdates(feed, cfg);
  updateStationDisplays();
}

function processTripUpdates(feed, cfg) {
  const stationIdBase = cfg.stationId;
  const stationKey = cfg.stationKey;
  feed.entity.forEach(entity => {
    if (!entity.tripUpdate || !entity.tripUpdate.stopTimeUpdate) return;
    const routeIdRaw = entity.tripUpdate.trip?.routeId || "Unknown";
    let routeId = normalizeRouteId(routeIdRaw);
    // For Court Square, treat "M" as "F" for display and ordering
    if (stationKey === "court-square" && routeId === "M") {
      routeId = "F";
    }
    entity.tripUpdate.stopTimeUpdate.forEach(stu => {
      const stopId = stu.stopId;
      if (!stopId) return;
      if (stopId.startsWith(stationIdBase)) {
        const direction = stopId.slice(-1);
        let bound = (direction === "N") ? "queens" : "manhattan";
        const arrivalObj = stu.arrival || stu.departure;
        if (!arrivalObj) return;
        const arrivalTime = arrivalObj.time.low || arrivalObj.time;
        if (!arrivalTime) return;
        const arrivalMs = arrivalTime * 1000;
        arrivals[stationKey][bound].push({
          arrivalTime: arrivalMs,
          routeId: routeId
        });
      }
    });
  });
  arrivals[cfg.stationKey].manhattan.sort((a, b) => a.arrivalTime - b.arrivalTime);
  arrivals[cfg.stationKey].queens.sort((a, b) => a.arrivalTime - b.arrivalTime);
}

//-----------------------------------------------------
// 4) DISPLAY LOGIC (UPDATING THE DOM)
//-----------------------------------------------------

function groupByLine(arr) {
  const groups = {};
  arr.forEach(item => {
    const key = item.routeId;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });
  return groups;
}

// Update station titles based on walking speed selection
function updateStationTitles() {
  const speed = document.getElementById("walk-speed-select").value;
  Object.keys(stationNames).forEach(key => {
    const button = document.getElementById("button-" + key);
    if (button) {
      const walkTime = walkTimes[key][speed];
      button.textContent = `${stationNames[key]} - ${walkTime} minute walk`;
    }
  });
}

function updateStationDisplays() {
  updateStationTitles();
  const speed = document.getElementById("walk-speed-select").value;
  Object.keys(arrivals).forEach(stKey => {
    const contentEl = document.getElementById("content-" + stKey);
    if (!contentEl) return;
    let html = "";
    const cutoff = Date.now() + (walkTimes[stKey][speed] * 60 * 1000);
    const manhattanArr = arrivals[stKey].manhattan.filter(t => t.arrivalTime > cutoff);
    const queensArr = arrivals[stKey].queens.filter(t => t.arrivalTime > cutoff);
    const groupsManhattan = groupByLine(manhattanArr);
    const groupsQueens = groupByLine(queensArr);
    let allLines = Array.from(new Set([...Object.keys(groupsManhattan), ...Object.keys(groupsQueens)]));
    
    // Custom ordering for Court Square and Queensboro Plaza
    if (stKey === "court-square") {
      // For Court Square, order should be E, F, 7, G (treat G22 as G)
      const order = { "E": 0, "F": 1, "7": 2, "G": 3, "G22": 3 };
      allLines.sort((a, b) => (order[a] !== undefined ? order[a] : 999) - (order[b] !== undefined ? order[b] : 999));
    } else if (stKey === "queensboro-plaza") {
      // For Queensboro Plaza, order should be N, W, 7.
      const order = { "N": 0, "W": 1, "7": 2 };
      allLines.sort((a, b) => (order[a] !== undefined ? order[a] : 999) - (order[b] !== undefined ? order[b] : 999));
    } else {
      allLines.sort();
    }
    
    if (allLines.length === 0) {
      html += `<p>No upcoming trains</p>`;
    } else {
      allLines.forEach(line => {
        // Special case: For Court Square and 21st Street G trains, only show one section labeled "Brooklyn Bound"
        if ((stKey === "court-square" || stKey === "21st-street") && (line === "G22" || line === "G")) {
          html += `<div class="mb-4 border p-2 rounded" style="background-color: rgba(108,190,69,0.2);">`;
          html += `<h4 class="text-xl font-bold mb-2">${line} Train</h4>`;
          html += `<div class="mb-2"><p class="font-semibold">Brooklyn Bound</p><ul class="list-disc ml-5">`;
          const manhattanTrains = groupsManhattan[line] ? groupsManhattan[line].slice(0, 3) : [];
          if (manhattanTrains.length === 0) {
            html += `<li>No upcoming trains</li>`;
          } else {
            manhattanTrains.forEach(train => {
              const minutesAway = Math.round((train.arrivalTime - Date.now()) / 60000);
              html += `<li>${minutesAway} minutes</li>`;
            });
          }
          html += `</ul></div></div>`;
        } else {
          // Use mapping for line background colors at 20% opacity
          const lineColors = {
            "7": "rgba(185,51,173,0.2)",
            "E": "rgba(0,57,166,0.2)",
            "M": "rgba(255,99,25,0.2)",
            "F": "rgba(255,99,25,0.2)", // Treat M as F for display
            "G": "rgba(108,190,69,0.2)",
            "G22": "rgba(108,190,69,0.2)",
            "N": "rgba(252,204,10,0.2)",
            "W": "rgba(252,204,10,0.2)"
          };
          const bgColor = lineColors[line] || "transparent";
          html += `<div class="mb-4 border p-2 rounded" style="background-color: ${bgColor};">`;
          html += `<h4 class="text-xl font-bold mb-2">${line} Train</h4>`;
          // Manhattan Bound section
          html += `<div class="mb-2"><p class="font-semibold">Manhattan Bound</p><ul class="list-disc ml-5">`;
          const manhattanTrains = groupsManhattan[line] ? groupsManhattan[line].slice(0, 3) : [];
          if (manhattanTrains.length === 0) {
            html += `<li>No upcoming trains</li>`;
          } else {
            manhattanTrains.forEach(train => {
              const minutesAway = Math.round((train.arrivalTime - Date.now()) / 60000);
              html += `<li>${minutesAway} minutes</li>`;
            });
          }
          html += `</ul></div>`;
          // Queens Bound section (only if not G train for Court Square/21st)
          if (!((stKey === "court-square" || stKey === "21st-street") && (line === "G22" || line === "G"))) {
            html += `<div class="mb-2"><p class="font-semibold">Queens Bound</p><ul class="list-disc ml-5">`;
            const queensTrains = groupsQueens[line] ? groupsQueens[line].slice(0, 3) : [];
            if (queensTrains.length === 0) {
              html += `<li>No upcoming trains</li>`;
            } else {
              queensTrains.forEach(train => {
                const minutesAway = Math.round((train.arrivalTime - Date.now()) / 60000);
                html += `<li>${minutesAway} minutes</li>`;
              });
            }
            html += `</ul></div>`;
          }
          html += `</div>`;
        }
      });
    }
    contentEl.innerHTML = html;
    if (window.innerWidth >= 768) {
      contentEl.classList.remove("hidden");
    } else {
      contentEl.classList.add("hidden");
    }
  });
}

//-----------------------------------------------------
// 5) TOGGLE FUNCTIONS
//-----------------------------------------------------
function toggleStation(station) {
  const content = document.getElementById("content-" + station);
  if (!content) return;
  content.classList.toggle("hidden");
}
window.toggleStation = toggleStation;

//-----------------------------------------------------
// 6) INIT: FETCH WEATHER & MTA DATA
//-----------------------------------------------------
fetchWeatherData();
fetchMTAData();

// Re-fetch MTA data every 60 seconds
setInterval(fetchMTAData, 60000);

// Update station displays when walking speed changes
document.getElementById("walk-speed-select").addEventListener("change", updateStationDisplays);
