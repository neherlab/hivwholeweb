function emptyDivs(id, keepData) {

 var svg = d3.select('#'+id);
 svg.selectAll("*").remove();

 if ((typeof(keepData) == "undefined") | (!keepData)) svg.datum(null);

}



function drawETI_diversity(id, data) {
    emptyDivs(id);

    var svg = d3.select("#"+id),
        divWidth = $('#'+id).parent().width();

    var margin = {top: 5, right: 20, bottom: 40, left: 80},
        width = 0.9 * divWidth - margin.left - margin.right,
        height = 400 - margin.top - margin.bottom;

    svg.attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.bottom + margin.top);

    var colorFunc = function(d) {
        var cscale = {'training':"#CCC", 'estimate':"#E41"};
        return cscale[d];
    }

    var tmax = d3.max(data.map(get_tmax));
    var dmax = d3.max(data.map(function(d) { return get_ymax(d.data)}));
    var dmin = d3.min(data.map(function(d) { return get_ymin(d.data)}));

    var y = d3.scale.linear()
         .domain([0.0, dmax*1.1])
//         .domain([1e-4, 0.5])
         .range([height, 0]);

    var x = d3.scale.linear()
         .domain([-1, 1.1 * tmax])
         .range([0, width]);

    var xAxis = d3.svg.axis()
        .scale(x)
        .orient("bottom");

    var xAxisTop = d3.svg.axis()
       .scale(x)
       .orient("bottom")
       .tickFormat("");

    var xAxisGrid = d3.svg.axis()
        .scale(x)
        .orient("bottom")
        .tickSize(-height, 0, 0)
        .tickFormat("");

    var yAxis_left = d3.svg.axis()
        .scale(y)
        .ticks(5)
        .orient("left");

    var yAxis_right = d3.svg.axis()
        .scale(y)
        .ticks(0)
        .orient("right");

    var yAxisGrid = d3.svg.axis()
        .scale(y)
        .orient("right")
        .tickSize(width, 0, 0)
        .tickFormat("");

    var vis = svg.append("g")
          .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

    // Draw the grid lines (they should stay behind)
    vis.append("g")
        .attr("class", "grid")
        .attr("transform", "translate(0," + height + ")")
        .call(xAxisGrid);

    vis.append("g")
        .attr("class", "grid")
        .call(yAxisGrid);

    vis.append("g")
          .attr("class", "d3-axis")
          .attr("transform", "translate(0," + height + ")")
          .call(xAxis)
          .append("text")
          .attr("x", width / 2)
          .attr("y", 40)
          .style("text-anchor", "middle")
          .text("Time from infection [days]");

    vis.append("g")
         .attr("class", "d3-axis")
         .call(xAxisTop);

    var dTextBox = vis.append("g")
          .attr("class", "d3-axis")
          .call(yAxis_left)
          .append("g")
          .attr("class", "d3-axis-textbox")
          .attr("transform", "rotate(-90)");

    dTextBox.append("text")
          .attr("dy", "-4.7em")
          .attr("x", -height / 2)
          .style("text-anchor", "middle")
          .text("diversity");

    vis.append("g")
        .attr("class", "d3-axis")
        .attr("transform", "translate(" + width + " ,0)")
        .call(yAxis_right);

    // prepare legend
    var xLeg = 0.73 * width,
        yLeg = height * (1.0 - 0.12 - 0.10 * Math.floor(data.length / 3));
    var legend = vis.append("g")
        .attr("class", "dataLegend")
        .attr("transform", "translate(" + xLeg + "," + yLeg + ")");

    // plot data
    vis.select("g.dataPlot")
        .data(data)
        .enter()
        .append("g")
        .attr("class", function(d) { return "dataPlot "+d.label; })
        .each(plotDotsLine);
//        .each(plotLegend);


    function plotLegend(d, i) {
        var xLeg = 0.085 * width * Math.floor(i / 4),
            yLeg = (i % 4) * 0.10 * height;

        var leg = legend.append("g")
            .attr("class", d.label)
            .attr("transform", "translate(" + xLeg + "," + yLeg + ")");

        leg.append("circle")
           .attr("class", "circle")
           .attr("cx", 3)
           .attr("cy", 0)
           .attr("r", 6)
           .style("fill", colorFunc(d.label));

        leg.append("text")
            .attr("x", 15)
            .attr("y", 3)
            .style("text-anchor", "left")
            .text(d.label);

    }

    function plotDotsLine(data, i) {
        // dots
        vis.append("g")
              .attr("class", "circles DG")
              .selectAll()
              .data(data.data)
              .enter()
              .append("circle")
              .attr("class", "circle")
              .attr("cx", function(d) { return x(d[0]); })
              .attr("cy", function(d) { return y(d[1]); })
              .attr("r", 6)
              .style("fill", colorFunc(data.label));

    }

    function lineFunction(data) {
     return d3.svg.line()
               .x(function(d) { return x(d[0]); })
               .y(function(d) { return y(d[1]); })
               .interpolate("linear")(data);
    }

    function get_tmax(data) {
     var tmax = 0;
     for (i = 0; i < data.data.length; i++) {
       if (data.data[i][0] > tmax) {
        tmax = data.data[i][0];
       }
     }
     return tmax;
    }

    function get_ymax(data) {
     var ymax = data[0][1];
     for (i = 1; i < data.length; i++) {
       if (data[i][1] > ymax) {
        ymax = data[i][1];
       }
     }
     return ymax;
    }

    function get_ymin(data) {
     var ymin = data[0][1];
     for (i = 1; i < data.length; i++) {
       if (data[i][1] < ymin) {
        ymin = data[i][1];
       }
     }
     return ymin;
    }

}




function drawETI_distribution(id, data) {
    emptyDivs(id);

    var svg = d3.select("#"+id),
        divWidth = $('#'+id).parent().width();

    var margin = {top: 5, right: 20, bottom: 40, left: 80},
        width = 0.9 * divWidth - margin.left - margin.right,
        height = 400 - margin.top - margin.bottom;

    svg.attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.bottom + margin.top);

    color = '#19C'

    var dmax = d3.max(data.y);
    var dmin = 0.0;

    var y = d3.scale.linear()
         .domain([0.0, dmax*1.1])
         .range([height, 0]);

    var x = d3.scale.linear()
         .domain([data.x[0], data.x[data.x.length-1]])
         .range([0, width]);

    var xAxis = d3.svg.axis()
        .scale(x)
        .orient("bottom");

    var xAxisTop = d3.svg.axis()
       .scale(x)
       .orient("bottom")
       .tickFormat("");

    var xAxisGrid = d3.svg.axis()
        .scale(x)
        .orient("bottom")
        .tickSize(-height, 0, 0)
        .tickFormat("");

    var yAxis_left = d3.svg.axis()
        .scale(y)
        .ticks(5)
        .orient("left");

    var yAxis_right = d3.svg.axis()
        .scale(y)
        .ticks(0)
        .orient("right");

    var yAxisGrid = d3.svg.axis()
        .scale(y)
        .orient("right")
        .tickSize(width, 0, 0)
        .tickFormat("");

    var vis = svg.append("g")
          .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

    // Draw the grid lines (they should stay behind)
    vis.append("g")
        .attr("class", "grid")
        .attr("transform", "translate(0," + height + ")")
        .call(xAxisGrid);

    vis.append("g")
        .attr("class", "grid")
        .call(yAxisGrid);

    vis.append("g")
          .attr("class", "d3-axis")
          .attr("transform", "translate(0," + height + ")")
          .call(xAxis)
          .append("text")
          .attr("x", width / 2)
          .attr("y", 40)
          .style("text-anchor", "middle")
          .text("Time from infection [days]");

    vis.append("g")
         .attr("class", "d3-axis")
         .call(xAxisTop);

    var dTextBox = vis.append("g")
          .attr("class", "d3-axis")
          .call(yAxis_left)
          .append("g")
          .attr("class", "d3-axis-textbox")
          .attr("transform", "rotate(-90)");

    dTextBox.append("text")
          .attr("dy", "-4.7em")
          .attr("x", -height / 2)
          .style("text-anchor", "middle")
          .text("#samples");

    vis.append("g")
        .attr("class", "d3-axis")
        .attr("transform", "translate(" + width + " ,0)")
        .call(yAxis_right);


    function plotDotsLine(data, i) {
        // dots
        var tmp = [];
        for (var i=0; i<data.y.length; i++){
          tmp.push({x:x(data.x[i]), y:y(data.y[i]), width:x(data.x[i+1])-x(data.x[i]), height:y(0)-y(data.y[i])});
        }
        console.log(tmp);
        vis.append("g")
              .attr("class", "bar ETI")
              .selectAll(".box")
              .data(tmp)
              .enter()
              .append("rect")
              .attr("class", "box")
              .attr("x", function(d) { return d.x; })
              .attr("y", function(d) { return d.y; })
              .attr("height", function(d) { return d.height; })
              .attr("width", function(d) { return d.width; })
              .style("fill", color)
              .style("stroke", d3.rgb(color).darker());

    }

    function lineFunction(data) {
     return d3.svg.line()
               .x(function(d) { return x(d[0]); })
               .y(function(d) { return y(d[1]); })
               .interpolate("linear")(data);
    }
    plotDotsLine(data);

}


