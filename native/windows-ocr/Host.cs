using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Windows.Globalization;
using Windows.Foundation;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage.Streams;

internal static class Host
{
    const int MaxRequestBytes = 17 * 1024 * 1024;
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = MaxRequestBytes, RecursionLimit = 12 };
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern int GetCurrentPackageFullName(ref uint length, StringBuilder name);

    sealed class HostError : Exception
    {
        internal readonly string Code;
        internal HostError(string code) { Code = code; }
    }
    static string Field(IDictionary<string, object> value, string key)
    {
        object item; return value.TryGetValue(key, out item) ? item as string : null;
    }
    static bool ReadExactly(Stream input, byte[] buffer)
    {
        int read = 0;
        while (read < buffer.Length)
        {
            int count = input.Read(buffer, read, buffer.Length - read);
            if (count == 0) { if (read == 0) return false; throw new EndOfStreamException(); }
            read += count;
        }
        return true;
    }
    static void WriteResponse(Stream output, object value)
    {
        byte[] body = Encoding.UTF8.GetBytes(Json.Serialize(value));
        if (body.Length > 900000) throw new HostError("INTERNAL");
        byte[] prefix = BitConverter.GetBytes((uint)body.Length);
        output.Write(prefix, 0, 4); output.Write(body, 0, body.Length); output.Flush();
    }
    static bool AllowedOrigin(string[] args)
    {
        if (args.Length == 0) return false;
        // Only origins explicitly installed by the user; no wildcard or arbitrary executable commands.
        string origin = args[0];
        string config = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "allowed-origins.json");
        if (!File.Exists(config)) return false;
        string[] allowed = Json.Deserialize<string[]>(File.ReadAllText(config));
        return allowed != null && allowed.Contains(origin, StringComparer.Ordinal);
    }
    static OcrEngine CreateEngine()
    {
        uint size = 0;
        int result = GetCurrentPackageFullName(ref size, null);
        if (result == 15700 || size == 0) throw new HostError("SETUP");
        var engine = OcrEngine.TryCreateFromLanguage(new Language("en"));
        if (engine == null) throw new HostError("LANGUAGE");
        return engine;
    }
    static async Task<T> Await<T>(IAsyncOperation<T> operation)
    {
        // Use the OS WinMetadata directly; no separately installed Windows SDK or
        // NuGet WinRT projection is required by the installed host.
        while (operation.Status == AsyncStatus.Started) await Task.Delay(10);
        if (operation.Status == AsyncStatus.Error) throw operation.ErrorCode;
        if (operation.Status == AsyncStatus.Canceled) throw new OperationCanceledException();
        return operation.GetResults();
    }
    static async Task<object> Handle(IDictionary<string, object> request, string id)
    {
        object version;
        if (!request.TryGetValue("version", out version) || Convert.ToInt32(version) != 1 || id == null || id.Length > 80 || Field(request, "language") != "en") throw new HostError("INVALID_REQUEST");
        string command = Field(request, "command");
        if (command != "ping" && command != "recognize") throw new HostError("INVALID_REQUEST");
        var engine = CreateEngine();
        string text = ""; bool resized = false;
        if (command == "recognize")
        {
            object value;
            if (!request.TryGetValue("image", out value)) throw new HostError("INVALID_IMAGE");
            var image = value as IDictionary<string, object>;
            if (image == null || Field(image, "mimeType") != "image/png") throw new HostError("INVALID_IMAGE");
            string base64 = Field(image, "base64");
            if (base64 == null || base64.Length > 16 * 1024 * 1024) throw new HostError("IMAGE_LIMIT");
            byte[] bytes;
            try { bytes = Convert.FromBase64String(base64); } catch { throw new HostError("INVALID_IMAGE"); }
            byte[] signature = { 137, 80, 78, 71, 13, 10, 26, 10 };
            if (bytes.Length < 24 || !bytes.Take(8).SequenceEqual(signature)) throw new HostError("INVALID_IMAGE");
            using (var stream = new InMemoryRandomAccessStream())
            {
                using (var writer = new DataWriter(stream.GetOutputStreamAt(0)))
                {
                    writer.WriteBytes(bytes); await Await<uint>(writer.StoreAsync()); writer.DetachStream();
                }
                Array.Clear(bytes, 0, bytes.Length); stream.Seek(0);
                var decoder = await Await<BitmapDecoder>(BitmapDecoder.CreateAsync(stream));
                if (decoder.PixelWidth == 0 || decoder.PixelHeight == 0 || (ulong)decoder.PixelWidth * decoder.PixelHeight > 32000000) throw new HostError("IMAGE_LIMIT");
                double scale = Math.Min(1.0, (double)OcrEngine.MaxImageDimension / Math.Max(decoder.PixelWidth, decoder.PixelHeight));
                resized = scale < 1;
                var transform = new BitmapTransform { ScaledWidth = Math.Max(1, (uint)(decoder.PixelWidth * scale)), ScaledHeight = Math.Max(1, (uint)(decoder.PixelHeight * scale)) };
                using (var bitmap = await Await<SoftwareBitmap>(decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Ignore, transform, ExifOrientationMode.IgnoreExifOrientation, ColorManagementMode.DoNotColorManage)))
                {
                    var result = await Await<OcrResult>(engine.RecognizeAsync(bitmap));
                    text = string.Join("\n", result.Lines.Select(line => line.Text));
                }
            }
        }
        if (text.Length > 200000) throw new HostError("IMAGE_LIMIT");
        return new { version = 1, id = id, ok = true, engine = "Windows.Media.Ocr", language = engine.RecognizerLanguage.LanguageTag, text = text, resized = resized };
    }
    [MTAThread]
    static int Main(string[] args)
    {
        // stdout is reserved exclusively for binary-framed native messages.
        if (!AllowedOrigin(args)) return 2;
        using (Stream input = Console.OpenStandardInput())
        using (Stream output = Console.OpenStandardOutput())
        {
            string id = "";
            try
            {
                byte[] prefix = new byte[4]; if (!ReadExactly(input, prefix)) return 0;
                uint length = BitConverter.ToUInt32(prefix, 0);
                if (length == 0 || length > MaxRequestBytes) return 3;
                byte[] body = new byte[length]; if (!ReadExactly(input, body)) return 3;
                var request = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(body));
                Array.Clear(body, 0, body.Length);
                id = Field(request, "id") ?? "";
                WriteResponse(output, Handle(request, id).GetAwaiter().GetResult());
            }
            catch (Exception error)
            {
                var known = error as HostError;
                try { WriteResponse(output, new { version = 1, id = id, ok = false, code = known == null ? "INTERNAL" : known.Code }); } catch { return 4; }
            }
        }
        return 0;
    }
}
