(function() {

function WebGL2Supported() {
   return typeof WebGL2RenderingContext !== "undefined";
}

WebGLStage = Utilities.createSubclass(Stage,
    function(element, options)
    {
        Stage.call(this);
    },
    {

        initialize: function(benchmark, options)
        {
            Stage.prototype.initialize.call(this, benchmark, options);

            var params = new URL(location.href).searchParams;
            this._params = {
                use_attributes: Boolean(params.get("use_attributes")),
                use_ubos: Boolean(params.get("use_ubos")),
                use_multi_draw: Boolean(params.get("use_multi_draw")),
                webgl_version: WebGL2Supported() ? (Number(params.get("webgl_version")) || 1) : 1,
            };

            if (this._params.webgl_version == 2) {
                this._gl = this.element.getContext("webgl2");
            } else {
                this._gl = this.element.getContext("webgl");
            }
            var gl = this._gl;

            this._multi_draw = this._params.use_multi_draw && gl.getExtension("WEBGL_multi_draw");
            if (this._params.use_multi_draw && !this._multi_draw) {
                console.warn("Disabling use_multi_draw. Extension not available.");
                this._params.use_multi_draw = false;
            }
            if (this._params.use_ubos && this._params.webgl_version !== 2) {
                console.warn("Disabling use_ubos. webgl_version is not 2.");
                this._params.use_ubos = false;
            }
            if (this._params.use_ubos && !this._params.use_multi_draw) {
                console.warn("Disabling use_ubos. use_multi_draw not enabled.");
                this._params.use_ubos = false;
            }
            if (this._params.use_multi_draw && !(this._params.use_ubos || this._params.use_attributes)) {
                const flag = this._params.webgl_version == 2 ? "use_ubos" : "use_attributes";
                console.warn("Defaulting to " + flag);
                this._params[flag] = true;
            }

            this._numTriangles = 0;
            this._bufferSize = 0;

            var use_ubos = this._params.use_ubos;
            var use_attributes = this._params.use_attributes;

            gl.clearColor(0.5, 0.5, 0.5, 1);

            // Create the vertex shader object.
            var vertexShader = gl.createShader(gl.VERTEX_SHADER);

            // The source code for the shader is extracted from the <script> element above.
            if (use_ubos) {
                let source = this._getFunctionSource("vertex-with-ubos");
                this._maxUniformArraySize = Math.floor(
                    gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE) /
                    (8 * Float32Array.BYTES_PER_ELEMENT));
                source = source.replace('MAX_ARRAY_SIZE', this._maxUniformArraySize);
                gl.shaderSource(vertexShader, source);
            } else if (use_attributes) {
                gl.shaderSource(vertexShader, this._getFunctionSource("vertex-with-attributes"));
            } else {
                gl.shaderSource(vertexShader, this._getFunctionSource("vertex-with-uniforms"));
            }

            // Compile the shader.
            gl.compileShader(vertexShader);
            if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
                // We failed to compile. Output to the console and quit.
                console.error("Vertex Shader failed to compile.");
                console.error(gl.getShaderInfoLog(vertexShader));
                return;
            }

            // Now do the fragment shader.
            var fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
            if (use_ubos) {
                gl.shaderSource(fragmentShader, this._getFunctionSource("fragment-300es"));
            } else {
                gl.shaderSource(fragmentShader, this._getFunctionSource("fragment"));
            }
            gl.compileShader(fragmentShader);
            if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
                console.error("Fragment Shader failed to compile.");
                console.error(gl.getShaderInfoLog(fragmentShader));
                return;
            }

            // We have two compiled shaders. Time to make the program.
            var program = gl.createProgram();
            gl.attachShader(program, vertexShader);
            gl.attachShader(program, fragmentShader);
            gl.linkProgram(program);

            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                console.error("Unable to link shaders into program.");
                console.error(gl.getProgramInfoLog(program));
                return;
            }

            // Our program has two inputs. We have a single uniform "color",
            // and one vertex attribute "position".

            gl.useProgram(program);
            this._uTime = gl.getUniformLocation(program, "time");
            if (use_ubos) {
                const blockIndex = gl.getUniformBlockIndex(program, "DrawData");
                gl.uniformBlockBinding(program, blockIndex, 0);
            } else if (use_attributes) {
                this._aScale = gl.getAttribLocation(program, "scale");
                this._aOffsetX = gl.getAttribLocation(program, "offsetX");
                this._aOffsetY = gl.getAttribLocation(program, "offsetY");
                this._aScalar = gl.getAttribLocation(program, "scalar");
                this._aScalarOffset = gl.getAttribLocation(program, "scalarOffset");

                gl.enableVertexAttribArray(this._aScale);
                gl.enableVertexAttribArray(this._aOffsetX);
                gl.enableVertexAttribArray(this._aOffsetY);
                gl.enableVertexAttribArray(this._aScalar);
                gl.enableVertexAttribArray(this._aScalarOffset);
            } else {
                this._uScale = gl.getUniformLocation(program, "scale");
                this._uOffsetX = gl.getUniformLocation(program, "offsetX");
                this._uOffsetY = gl.getUniformLocation(program, "offsetY");
                this._uScalar = gl.getUniformLocation(program, "scalar");
                this._uScalarOffset = gl.getUniformLocation(program, "scalarOffset");
            }

            this._aPosition = gl.getAttribLocation(program, "position");
            gl.enableVertexAttribArray(this._aPosition);

            this._aColor = gl.getAttribLocation(program, "color");
            gl.enableVertexAttribArray(this._aColor);

            this._positionData = new Float32Array([
                // x y z 1
                   0,  0.1, 0, 1,
                -0.1, -0.1, 0, 1,
                 0.1, -0.1, 0, 1
            ]);

            this._colorData = new Float32Array([
                1, 0, 0, 1,
                0, 1, 0, 1,
                0, 0, 1, 1
            ]);

            if (!use_attributes && !use_ubos) {
                this._positionBuffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, this._positionBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, this._positionData, gl.STATIC_DRAW);

                this._colorBuffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, this._colorBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, this._colorData, gl.STATIC_DRAW);
            }

            this._resetIfNecessary();
        },

        _getFunctionSource: function(id)
        {
            return document.getElementById(id).text;
        },

        _resetIfNecessary: function()
        {
            var gl = this._gl;
            if (this._numTriangles <= this._bufferSize)
                return;

            if (!this._bufferSize)
                this._bufferSize = 128;

            while (this._numTriangles > this._bufferSize)
                this._bufferSize *= 4;

            var use_attributes = this._params.use_attributes;
            var use_ubos = this._params.use_ubos;
            var use_multi_draw = this._params.use_multi_draw;

            if (use_multi_draw) {
                this._multi_draw_firsts = new Int32Array(this._bufferSize);
                this._multi_draw_counts = new Int32Array(this._bufferSize);
                for (var i = 0; i < this._bufferSize; ++i) {
                    this._multi_draw_firsts[i] = i * 3;
                }
                this._multi_draw_counts.fill(3);
            }

            if (use_multi_draw || use_attributes) {
                var positionData = new Float32Array(this._bufferSize * this._positionData.length);
                var colorData = new Float32Array(this._bufferSize * this._colorData.length);
                for (var i = 0; i < this._bufferSize; ++i) {
                    positionData.set(this._positionData, i * this._positionData.length);
                    colorData.set(this._colorData, i * this._colorData.length);
                }

                this._positionBuffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, this._positionBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, positionData, gl.STATIC_DRAW);

                this._colorBuffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, this._colorBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, colorData, gl.STATIC_DRAW);

                // Bind for draw
                gl.bindBuffer(gl.ARRAY_BUFFER, this._positionBuffer);
                gl.vertexAttribPointer(this._aPosition, 4, gl.FLOAT, false, 0, 0);

                gl.bindBuffer(gl.ARRAY_BUFFER, this._colorBuffer);
                gl.vertexAttribPointer(this._aColor, 4, gl.FLOAT, false, 0, 0);
            }


            if (use_ubos) {
                this._transformData = new Float32Array(this._bufferSize * 8);
                for (var i = 0; i < this._bufferSize; ++i) {
                    var scale = Stage.random(0.2, 0.4);
                    var offsetX = Stage.random(-0.9, 0.9);
                    var offsetY = Stage.random(-0.9, 0.9);
                    var scalar = Stage.random(0.5, 2);
                    var scalarOffset = Stage.random(0, 10);

                    this._transformData[i * 8 + 0] = scale;
                    this._transformData[i * 8 + 1] = offsetX;
                    this._transformData[i * 8 + 2] = offsetY;
                    this._transformData[i * 8 + 3] = scalar;
                    this._transformData[i * 8 + 4] = scalarOffset;
                }

                const uniformBufferCount = Math.ceil(this._bufferSize / this._maxUniformArraySize);
                this._uniformBuffers = new Array(uniformBufferCount);
                for (let i = 0; i < uniformBufferCount; ++i) {
                    const buffer = gl.createBuffer();
                    gl.bindBuffer(gl.UNIFORM_BUFFER, buffer);
                    gl.bufferData(gl.UNIFORM_BUFFER, this._transformData.slice(
                      this._maxUniformArraySize * 8 * i,
                      this._maxUniformArraySize * 8 * (i + 1),
                    ), gl.STATIC_DRAW);
                    gl.bindBuffer(gl.UNIFORM_BUFFER, null);
                    this._uniformBuffers[i] = buffer;
                }

            } else if (use_attributes) {
                this._transformData = new Float32Array(this._bufferSize * 5 * 3);
                for (var i = 0; i < this._bufferSize; ++i) {
                    var scale = Stage.random(0.2, 0.4);
                    var offsetX = Stage.random(-0.9, 0.9);
                    var offsetY = Stage.random(-0.9, 0.9);
                    var scalar = Stage.random(0.5, 2);
                    var scalarOffset = Stage.random(0, 10);
                    for (var j = 0; j < 3; ++j) {
                        this._transformData[i * 3 * 5 + j * 5 + 0] = scale;
                        this._transformData[i * 3 * 5 + j * 5 + 1] = offsetX;
                        this._transformData[i * 3 * 5 + j * 5 + 2] = offsetY;
                        this._transformData[i * 3 * 5 + j * 5 + 3] = scalar;
                        this._transformData[i * 3 * 5 + j * 5 + 4] = scalarOffset;
                    }
                }

                this._transformBuffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, this._transformBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, this._transformData, gl.STATIC_DRAW);

                gl.bindBuffer(gl.ARRAY_BUFFER, this._transformBuffer);
                gl.vertexAttribPointer(this._aScale,        1, gl.FLOAT, false, 5 * 4, 0 * 4);
                gl.vertexAttribPointer(this._aOffsetX,      1, gl.FLOAT, false, 5 * 4, 1 * 4);
                gl.vertexAttribPointer(this._aOffsetY,      1, gl.FLOAT, false, 5 * 4, 2 * 4);
                gl.vertexAttribPointer(this._aScalar,       1, gl.FLOAT, false, 5 * 4, 3 * 4);
                gl.vertexAttribPointer(this._aScalarOffset, 1, gl.FLOAT, false, 5 * 4, 4 * 4);
            } else {
                this._uniformData = new Float32Array(this._bufferSize * 6);
                for (var i = 0; i < this._bufferSize; ++i) {
                    this._uniformData[i * 6 + 0] = Stage.random(0.2, 0.4);
                    this._uniformData[i * 6 + 1] = 0;
                    this._uniformData[i * 6 + 2] = Stage.random(-0.9, 0.9);
                    this._uniformData[i * 6 + 3] = Stage.random(-0.9, 0.9);
                    this._uniformData[i * 6 + 4] = Stage.random(0.5, 2);
                    this._uniformData[i * 6 + 5] = Stage.random(0, 10);
                }
            }

            // Bind for draw
            gl.bindBuffer(gl.ARRAY_BUFFER, this._positionBuffer);
            gl.vertexAttribPointer(this._aPosition, 4, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this._colorBuffer);
            gl.vertexAttribPointer(this._aColor, 4, gl.FLOAT, false, 0, 0);
        },

        tune: function(count)
        {
            if (!count)
                return;

            this._numTriangles += count;
            this._numTriangles = Math.max(this._numTriangles, 0);

            this._resetIfNecessary();
        },

        animate: function(timeDelta)
        {
            var gl = this._gl;

            gl.clear(gl.COLOR_BUFFER_BIT);

            if (!this._startTime)
                this._startTime = Stage.dateCounterValue(1000);
            var elapsedTime = Stage.dateCounterValue(1000) - this._startTime;

            if (this._params.use_multi_draw) {
                gl.uniform1f(this._uTime, elapsedTime);
                if (this._params.use_ubos) {
                    for (let chunk = 0; chunk < Math.ceil(this._numTriangles / this._maxUniformArraySize); chunk++) {
                        gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this._uniformBuffers[chunk]);
                        this._multi_draw.multiDrawArraysWEBGL(
                          gl.TRIANGLES,
                          this._multi_draw_firsts, chunk * this._maxUniformArraySize,
                          this._multi_draw_counts, chunk * this._maxUniformArraySize,
                          this._maxUniformArraySize);
                    }
                } else {
                    this._multi_draw.multiDrawArraysWEBGL(
                        gl.TRIANGLES,
                        this._multi_draw_firsts, 0,
                        this._multi_draw_counts, 0,
                        this._numTriangles);
                }
            } else if (this._params.use_attributes) {
                gl.uniform1f(this._uTime, elapsedTime);
                for (var i = 0; i < this._numTriangles; ++i) {
                    gl.drawArrays(gl.TRIANGLES, i * 3, 3);
                }
            } else {
                for (var i = 0; i < this._numTriangles; ++i) {

                    this._uniformData[i * 6 + 1] = elapsedTime;

                    var uniformDataOffset = i * 6;
                    gl.uniform1f(this._uScale, this._uniformData[uniformDataOffset++]);
                    gl.uniform1f(this._uTime, this._uniformData[uniformDataOffset++]);
                    gl.uniform1f(this._uOffsetX, this._uniformData[uniformDataOffset++]);
                    gl.uniform1f(this._uOffsetY, this._uniformData[uniformDataOffset++]);
                    gl.uniform1f(this._uScalar, this._uniformData[uniformDataOffset++]);
                    gl.uniform1f(this._uScalarOffset, this._uniformData[uniformDataOffset++]);

                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                }
            }
        },

        complexity: function()
        {
            return this._numTriangles;
        }
    }
);

WebGLBenchmark = Utilities.createSubclass(Benchmark,
    function(options)
    {
        Benchmark.call(this, new WebGLStage(), options);
    }
);

window.benchmarkClass = WebGLBenchmark;

})();


